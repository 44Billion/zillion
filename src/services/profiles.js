import { isOnline, onOnline } from 'libp2r2p/network'
import { eventToProfile, getProfile, selectPreferredProfile } from '#helpers/nostr/queries.js'
import { createRelayRead, REFRESH_MS } from './relay-read.js'

const hex = value => /^[0-9a-f]{64}$/.test(value || '')

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
  const interested = entry => remote && entry.pubkey !== owner && [...entry.consumers].some(consumer => consumer.remote)
  const current = entry => !lifetime.signal.aborted && entries.get(entry.pubkey) === entry
  function update (entry, profile) {
    if (!profile || !current(entry)) return
    const preferred = selectPreferredProfile(entry.profile, profile)
    if (preferred === entry.profile || (entry.profile && preferred.meta?.events?.[0]?.id === entry.profile.meta?.events?.[0]?.id)) return
    entry.profile = preferred
    onProfile(entry.pubkey, preferred)
    for (const consumer of entry.consumers) consumer.onProfile?.(preferred)
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
        for (const entry of pending) entry.ready.resolve(entry.profile)
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
    try {
      const result = await entry.read.query(signal)
      signal.throwIfAborted()
      const event = result.byPubkey?.[entry.pubkey]
      const profile = event?.pubkey === entry.pubkey ? eventToProfile(event) : null
      const online = profile ? true : await check()
      signal.throwIfAborted()
      entry.read.settle(result, { found: !!profile, online })
      entry.state = profile ? 'success' : Number.isFinite(entry.read.nextAt) ? 'pending' : 'stopped'
      if (!online) offline = true
      if (profile) {
        entry.refreshedAt = now()
        update(entry, profile)
        // Persistence failure never discards received metadata or retries a
        // successful network lookup. Keep the original signed event intact.
        try { await eventStore.add(event) } catch (error) { if (!signal.aborted) onError(error) }
      }
    } catch (error) {
      if (!signal.aborted) { entry.state = 'stopped'; onError(error) }
    } finally {
      if (entry.controller === controller) entry.controller = null
      active--
      entry.ready.resolve(entry.profile)
      schedule()
    }
  }
  function entryFor (pubkey) {
    if (entries.has(pubkey)) return entries.get(pubkey)
    const entry = {
      pubkey, profile: null, consumers: new Set(), state: 'pending', localDone: false,
      refreshedAt: -Infinity, ready: Promise.withResolvers(), controller: null,
      read: createRelayRead({ pubkey, kind: 0, now, retryDelays, cooldowns, queryLatest, getEvents, timeout })
    }
    entries.set(pubkey, entry)
    readLocal(entry)
    return entry
  }
  function readLocal (entry) {
    entry.localFailed = false
    entry.local = getProfile(entry.pubkey, { eventStore }).then(profile => update(entry, profile))
      .catch(error => { entry.localFailed = true; if (current(entry)) onError(error) })
      .finally(() => {
        entry.localDone = true
        if (!interested(entry) || offline) entry.ready.resolve(entry.profile)
        schedule()
      })
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
      for (const entry of entries.values()) if (entry.localFailed && entry.consumers.size) readLocal(entry)
    },
    retain (pubkey, { remote = true, onProfile } = {}) {
      if (!hex(pubkey) || lifetime.signal.aborted) return { ready: Promise.resolve(null), release () {} }
      const entry = entryFor(pubkey)
      const consumer = { remote, onProfile }
      entry.consumers.add(consumer)
      if (offline && entry.localDone) entry.ready.resolve(entry.profile)
      if (entry.profile) onProfile?.(entry.profile)
      if (entry.state === 'success' && now() - entry.refreshedAt >= REFRESH_MS) entry.state = 'pending'
      schedule()
      const released = Promise.withResolvers()
      return {
        ready: Promise.race([released.promise, remote && pubkey !== owner ? entry.ready.promise : entry.local.then(() => entry.profile)]),
        release () {
          released.resolve(null)
          entry.consumers.delete(consumer)
          if (!interested(entry)) entry.controller?.abort()
          schedule()
        }
      }
    },
    close () {
      lifetime.abort(); stopOnline(); clearTimeout(timer)
      stream?.return().catch(() => {})
      for (const entry of entries.values()) { entry.controller?.abort(); entry.ready.resolve(entry.profile); entry.consumers.clear() }
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
  const binding = {
    handle: null,
    attach () {
      this.handle?.release()
      this.handle = profiles?.retain(pubkey, options)
      this.handle?.ready.then(initial.resolve)
    }
  }
  bindings.add(binding); binding.attach()
  const release = () => { bindings.delete(binding); binding.handle?.release(); binding.handle = null; initial.resolve(null) }
  return { ready: initial.promise, release }
}
