import { isOnline, onOnline } from 'libp2r2p/network'
import { eventToProfile, getProfile, selectPreferredProfile } from '#helpers/nostr/queries.js'
import { createRelayRead, REFRESH_MS } from './relay-read.js'

const hex = value => /^[0-9a-f]{64}$/.test(value || '')
const LOCAL_PROFILE_BATCH_SIZE = 64
const LOCAL_PROFILE_RESULT_LIMIT = 200
const LOCAL_PROFILE_BATCH_CONCURRENCY = 2

export function createProfiles ({ owner, eventStore, onProfile = () => {}, onError = () => {}, checkOnline = isOnline, watchOnline = onOnline, queryLatest, getEvents, now = Date.now, retryDelays, timeout, remote = true }) {
  const entries = new Map()
  const cooldowns = new Map()
  const lifetime = new AbortController()
  let active = 0
  let offline = false
  let pumping = false
  let scheduled = false
  let timer
  let probe
  let stream
  let streamFailed = false
  const localQueue = new Set()
  let localBatchScheduled = false
  let localBatchesActive = 0
  const interested = entry => remote && entry.pubkey !== owner && [...entry.consumers].some(consumer => consumer.remote)
  const current = entry => !lifetime.signal.aborted && entries.get(entry.pubkey) === entry
  function notifyInitial (entry) {
    if (!current(entry)) return
    const pending = !entry.profile && !entry.initialSettled && (!entry.localDone || (interested(entry) && !offline))
    for (const consumer of entry.consumers) {
      if (consumer.pending === pending) continue
      consumer.pending = pending
      consumer.onInitialState?.({ pending })
    }
  }
  function finishInitial (entry) {
    entry.initialSettled = true
    entry.initial.resolve(entry.profile)
    notifyInitial(entry)
  }
  function update (entry, profile) {
    if (!profile || !current(entry)) return
    const preferred = selectPreferredProfile(entry.profile, profile)
    if (preferred === entry.profile || (entry.profile && preferred.meta?.events?.[0]?.id === entry.profile.meta?.events?.[0]?.id)) return
    entry.profile = preferred
    onProfile(entry.pubkey, preferred)
    for (const consumer of entry.consumers) consumer.onProfile?.(preferred)
    finishInitial(entry)
  }
  function check () {
    if (!probe) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 6000)
      probe = Promise.resolve().then(() => checkOnline({ signal: AbortSignal.any([lifetime.signal, controller.signal]) }))
        .catch(error => { if (!lifetime.signal.aborted) onError(error); return false })
        .finally(() => { clearTimeout(timeout); probe = null })
    }
    return probe
  }
  function schedule () {
    clearTimeout(timer)
    if (scheduled || lifetime.signal.aborted) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; pump().catch(onError) })
  }
  async function pump () {
    if (pumping || offline || lifetime.signal.aborted || active >= 4) return
    pumping = true
    try {
      const pending = [...entries.values()].filter(entry => interested(entry) && entry.localDone && !entry.controller && entry.state === 'pending')
      if (!pending.length) return
      if (!pending.some(entry => entry.read.nextAt <= now())) {
        const due = Math.min(...pending.map(entry => entry.read.nextAt))
        if (Number.isFinite(due)) timer = setTimeout(schedule, Math.max(0, due - now()))
        return
      }
      if (!await check()) {
        offline = true
        for (const entry of entries.values()) {
          if (entry.localDone) { entry.ready.resolve(entry.profile); finishInitial(entry) }
        }
        return
      }
      if (lifetime.signal.aborted) return
      for (const entry of pending) {
        if (active >= 4) break
        if (!interested(entry) || entry.controller || entry.state !== 'pending' || entry.read.nextAt > now()) continue
        const controller = new AbortController()
        entry.controller = controller
        active++
        run(entry, controller).catch(onError)
      }
    } finally {
      pumping = false
      if (!offline && active < 4 && [...entries.values()].some(entry => interested(entry) && entry.localDone && !entry.controller && entry.state === 'pending' && entry.read.nextAt <= now())) schedule()
    }
  }
  async function run (entry, controller) {
    const signal = AbortSignal.any([lifetime.signal, controller.signal])
    let received
    try {
      const result = await entry.read.query(signal)
      signal.throwIfAborted()
      const event = result.byPubkey?.[entry.pubkey]
      const profile = event?.pubkey === entry.pubkey ? eventToProfile(event) : null
      if (profile) update(entry, profile)
      finishInitial(entry)
      const online = profile ? true : await check()
      signal.throwIfAborted()
      entry.read.settle(result, { found: !!profile, online })
      entry.state = profile ? 'success' : Number.isFinite(entry.read.nextAt) ? 'pending' : 'stopped'
      if (!online) offline = true
      if (profile) {
        entry.refreshedAt = now()
        received = event
      }
    } catch (error) {
      if (!signal.aborted) { entry.state = 'stopped'; onError(error) }
    } finally {
      if (entry.controller === controller) entry.controller = null
      active--
      finishInitial(entry)
      entry.ready.resolve(entry.profile)
      schedule()
    }
    // Release network admission/readiness before storage, retaining the original
    // signed event. Storage refusal never changes relay success or schedules IO.
    if (received && !signal.aborted) {
      try {
        const result = await eventStore.add(received)
        if (result?.ok === false && !signal.aborted) {
          onError(Object.assign(new Error(result.message || 'Could not persist profile event', { cause: result }), { code: result.code }))
        }
      } catch (error) { if (!signal.aborted) onError(error) }
    }
  }
  function entryFor (pubkey) {
    if (entries.has(pubkey)) return entries.get(pubkey)
    const entry = {
      pubkey, profile: null, consumers: new Set(), state: 'pending', localDone: false, initialSettled: false,
      refreshedAt: -Infinity, ready: Promise.withResolvers(), initial: Promise.withResolvers(), controller: null,
      read: createRelayRead({ pubkey, kind: 0, now, retryDelays, cooldowns, queryLatest, getEvents, timeout })
    }
    entries.set(pubkey, entry)
    queueLocal(entry)
    return entry
  }
  function settleLocal (entry, profile) {
    entry.localDone = true
    if (!interested(entry) || offline) { entry.ready.resolve(entry.profile); entry.initial.resolve(entry.profile) }
    if (offline) finishInitial(entry)
    else notifyInitial(entry)
    entry.localState.resolve(profile)
    entry.localSnapshot.resolve(profile)
    schedule()
  }
  async function readLocalProfiles (pubkeys) {
    const { results = [] } = await eventStore.query({
      kinds: [0],
      authors: pubkeys,
      limit: LOCAL_PROFILE_RESULT_LIMIT
    })
    const profiles = new Map()
    for (const event of results) {
      const profile = eventToProfile(event)
      if (!profile) continue
      profiles.set(event.pubkey, selectPreferredProfile(profiles.get(event.pubkey), profile))
    }
    const missing = pubkeys.filter(pubkey => !profiles.has(pubkey))
    if (results.length >= LOCAL_PROFILE_RESULT_LIMIT && missing.length) {
      if (pubkeys.length === 1) {
        const profile = await getProfile(pubkeys[0], { eventStore })
        if (profile) profiles.set(pubkeys[0], profile)
      } else {
        const middle = Math.ceil(pubkeys.length / 2)
        const [left, right] = await Promise.all([
          readLocalProfiles(pubkeys.slice(0, middle)),
          readLocalProfiles(pubkeys.slice(middle))
        ])
        for (const [pubkey, profile] of left) profiles.set(pubkey, profile)
        for (const [pubkey, profile] of right) profiles.set(pubkey, profile)
      }
    }
    return profiles
  }
  async function runLocalBatch (batch) {
    let profiles
    try { profiles = await readLocalProfiles(batch.map(entry => entry.pubkey)) } catch (error) {
      if (!lifetime.signal.aborted) onError(error)
      for (const entry of batch) {
        if (!current(entry)) continue
        entry.localFailed = true
        settleLocal(entry, null)
      }
      return
    }
    for (const entry of batch) {
      if (lifetime.signal.aborted) break
      const profile = profiles.get(entry.pubkey) || null
      if (current(entry) && profile) update(entry, profile)
      if (current(entry)) settleLocal(entry, profile)
    }
  }
  function pumpLocalBatches () {
    while (!lifetime.signal.aborted && localBatchesActive < LOCAL_PROFILE_BATCH_CONCURRENCY && localQueue.size) {
      const batch = [...localQueue].slice(0, LOCAL_PROFILE_BATCH_SIZE)
      for (const entry of batch) localQueue.delete(entry)
      localBatchesActive++
      runLocalBatch(batch).catch(onError).finally(() => {
        localBatchesActive--
        if (!lifetime.signal.aborted && localQueue.size) scheduleLocalBatch()
      })
    }
  }
  function scheduleLocalBatch () {
    if (localBatchScheduled || lifetime.signal.aborted) return
    localBatchScheduled = true
    queueMicrotask(() => {
      localBatchScheduled = false
      pumpLocalBatches()
    })
  }
  function queueLocal (entry) {
    entry.localFailed = false
    entry.localState = Promise.withResolvers()
    entry.local = entry.localState.promise
    entry.localSnapshot = Promise.withResolvers()
    localQueue.add(entry)
    scheduleLocalBatch()
  }
  const stopOnline = watchOnline(() => {
    if (lifetime.signal.aborted) return
    offline = false
    for (const entry of entries.values()) {
      if (interested(entry) && entry.state === 'success' && now() - entry.refreshedAt >= REFRESH_MS) entry.state = 'pending'
    }
    schedule()
  })
  function openLocalStream () {
    streamFailed = false
    try {
      stream = eventStore.subscribe({ kinds: [0] }, { initial: false })
      ;(async () => {
        for await (const item of stream) {
          if (lifetime.signal.aborted) return
          if (item.type !== 'event') continue
          const entry = entries.get(item.event.pubkey)
          if (!entry) continue
          const profile = eventToProfile(item.event)
          update(entry, profile)
          if (profile && entry.localDone && !entry.controller && entry.state === 'pending') {
            entry.read.settle({ requests: [] }, { found: true })
            entry.state = 'success'
            entry.ready.resolve(entry.profile)
            schedule()
          }
        }
        streamFailed = true
      })().catch(error => { streamFailed = true; if (!lifetime.signal.aborted) onError(error) })
    } catch (error) { streamFailed = true; onError(error) }
  }
  openLocalStream()
  return {
    recoverLocal () {
      if (lifetime.signal.aborted) return
      if (streamFailed) openLocalStream()
      for (const entry of entries.values()) if (entry.localFailed && entry.consumers.size) queueLocal(entry)
    },
    retain (pubkey, { remote = true, onProfile, onInitialState } = {}) {
      if (!hex(pubkey) || lifetime.signal.aborted) {
        onInitialState?.({ pending: false })
        return { ready: Promise.resolve(null), initialReady: Promise.resolve(null), localReady: Promise.resolve(null), release () {} }
      }
      const entry = entryFor(pubkey)
      const consumer = { remote, onProfile, onInitialState }
      entry.consumers.add(consumer)
      if (offline && entry.localDone) { entry.ready.resolve(entry.profile); finishInitial(entry) }
      if (entry.profile) onProfile?.(entry.profile)
      notifyInitial(entry)
      if (entry.state === 'success' && now() - entry.refreshedAt >= REFRESH_MS) entry.state = 'pending'
      schedule()
      const released = Promise.withResolvers()
      return {
        localReady: Promise.race([released.promise, entry.localSnapshot.promise]),
        ready: Promise.race([released.promise, remote && pubkey !== owner ? entry.ready.promise : entry.local.then(() => entry.profile)]),
        initialReady: Promise.race([released.promise, remote && pubkey !== owner ? entry.initial.promise : entry.local.then(() => entry.profile)]),
        release () {
          released.resolve(null)
          entry.consumers.delete(consumer)
          if (!interested(entry)) entry.controller?.abort()
          notifyInitial(entry)
          schedule()
        }
      }
    },
    close () {
      lifetime.abort(); stopOnline(); clearTimeout(timer)
      stream?.return().catch(() => {})
      localQueue.clear()
      for (const entry of entries.values()) {
        entry.controller?.abort()
        entry.ready.resolve(entry.profile)
        entry.initial.resolve(entry.profile)
        entry.localState?.resolve(null)
        entry.localSnapshot.resolve(null)
        entry.consumers.clear()
      }
      entries.clear(); cooldowns.clear()
    }
  }
}

// Root-owned service, with consumer lifetimes independent of root task order.
// Avatars never construct another coordinator or another event-store reader.
let profiles
const bindings = new Set()
export function attachProfiles (service) {
  profiles = service
  for (const binding of bindings) binding.attach()
  return () => {
    if (profiles !== service) return
    profiles = null
    for (const binding of bindings) { binding.handle?.release(); binding.handle = null }
  }
}
export function observeProfile (pubkey, options = {}) {
  const initial = Promise.withResolvers()
  const ordering = Promise.withResolvers()
  const local = Promise.withResolvers()
  const binding = {
    handle: null,
    attach () {
      this.handle?.release()
      this.handle = profiles?.retain(pubkey, options)
      if (!this.handle) options.onInitialState?.({ pending: hex(pubkey) })
      this.handle?.ready.then(initial.resolve)
      this.handle?.initialReady.then(ordering.resolve)
      this.handle?.localReady.then(local.resolve)
    }
  }
  bindings.add(binding); binding.attach()
  const release = () => { bindings.delete(binding); binding.handle?.release(); binding.handle = null; initial.resolve(null); ordering.resolve(null); local.resolve(null) }
  return { ready: initial.promise, initialReady: ordering.promise, localReady: local.promise, release }
}
