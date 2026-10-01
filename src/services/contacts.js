import { getLatestEventsByPubkey, relayPool } from 'libp2r2p/relay'
import { isOnline, onOnline } from 'libp2r2p/network'
import { PERSONAL_COPY } from 'libp2r2p/kind'
import { isValidEvent } from 'libp2r2p/event'
import { decryptPersonalCopy } from './chat-references.js'

export const CONTACTS_DTAG = '+zillion:contacts'
const CONTACTS_REFRESH_TIMEOUT_MS = 15000
const CONTACTS_ONLINE_TIMEOUT_MS = 6000
// Exponential backoff capped at 5 minutes.
const CONTACTS_REFRESH_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 5 * 60 * 1000]
const hex = value => /^[0-9a-f]{64}$/.test(value || '')
const preferred = (a, b) => !a || b.created_at > a.created_at || (b.created_at === a.created_at && b.id < a.id) ? b : a
// NostrDB decorates owner-authored tags with reserved "~..." values. They are
// never metadata: a decorated kind-3 tag may occupy the relay-hint slot, and
// the store strips decorations on merge, so copying one into a new tag shifts
// every later value.
const isDecoration = value => typeof value === 'string' && value.startsWith('~')
const tagValue = (tag, index) => typeof tag?.[index] === 'string' && !isDecoration(tag[index]) ? tag[index] : ''
// The override label merges every state letter in one slot: 'r' removes the
// contact (and wins over 'p'), 'p' pins it, and absent/empty/unknown values
// mean an unpinned contact. Letter order never matters; unknown letters are
// ignored so newer interoperable writers can add labels without breaking us.
function entryState (tag) {
  const label = typeof tag?.[4] === 'string' && !isDecoration(tag[4]) ? tag[4] : ''
  const removed = label.includes('r')
  return { relayHint: tagValue(tag, 2), petname: tagValue(tag, 3), removed, pinned: !removed && label.includes('p') }
}
export function contactMembership (lists, owner) {
  const contacts = new Map()
  for (const event of lists.slice(0, 2)) {
    if (event?.pubkey !== owner) continue
    for (const tag of event.tags) if (tag[0] === 'p' && hex(tag[1]) && tag[1] !== owner) contacts.set(tag[1], { pubkey: tag[1], relayHint: tagValue(tag, 2), petname: tagValue(tag, 3), pinned: false })
  }
  const overrides = lists[2]
  if (overrides?.pubkey === owner) {
    for (const tag of overrides.tags) {
      if (tag[0] !== 'p' || !hex(tag[1]) || tag[1] === owner) continue
      const { relayHint, petname, removed, pinned } = entryState(tag)
      if (removed) contacts.delete(tag[1])
      else contacts.set(tag[1], { pubkey: tag[1], relayHint, petname, pinned })
    }
  }
  return [...contacts.values()]
}

// A removed entry only excludes a peer that a kind-3 snapshot follows. Keep
// every override while the public snapshot is unknown: a missing list may
// follow the peer. The local CRDT merge turns an omitted entry into a durable
// tombstone, so dropping the tag here removes it across merges.
export function compactContactOverrides (lists, owner, tags) {
  if (lists[0]?.pubkey !== owner) return tags
  const followed = new Set()
  for (const event of lists.slice(0, 2)) {
    if (event?.pubkey !== owner) continue
    for (const tag of event.tags) if (tag[0] === 'p' && hex(tag[1]) && tag[1] !== owner) followed.add(tag[1])
  }
  return tags.filter(tag => tag[0] !== 'p' || !entryState(tag).removed || followed.has(tag[1]))
}

export function createContacts ({ owner, signer, eventStore, onChange, onState = () => {}, onError = () => {}, _getEvents, _retryDelays = CONTACTS_REFRESH_DELAYS, _isOnline = isOnline, _onOnline = onOnline }) {
  const lists = [null, null, null]
  let streams = []
  let generation = 0
  let writes = Promise.resolve()
  let context
  let coordinates
  let starting
  let loaded = false
  let remote
  const requestEvents = _getEvents ?? ((filter, relays, options) => relayPool.getEvents(filter, relays, options))
  const notify = () => onChange(contactMembership(lists, owner))
  function pause (ms, signal) {
    if (signal.aborted) return Promise.resolve()
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
  }
  function waitForOnline (signal) {
    if (signal.aborted) return Promise.resolve(false)
    return new Promise(resolve => {
      let finished = false
      let stop = () => {}
      const finish = value => {
        if (finished) return
        finished = true
        stop()
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      }
      const onAbort = () => finish(false)
      stop = _onOnline(() => finish(true))
      if (finished) stop()
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

  async function deviceOffline (signal) {
    try {
      const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(CONTACTS_ONLINE_TIMEOUT_MS)])
      return await _isOnline({ signal: probeSignal }) === false
    } catch {
      return false
    }
  }

  async function refreshPublicList (version, signal) {
    let attempt = 0
    while (!signal.aborted && !lists[0]) {
      if (version !== generation) return
      try {
        const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(CONTACTS_REFRESH_TIMEOUT_MS)])
        const getEvents = (filter, relays, options = {}) => requestEvents(filter, relays, { ...options, signal: attemptSignal })
        const { byPubkey } = await getLatestEventsByPubkey([owner], { kinds: [3], _getEvents: getEvents, relayListOptions: { _getEvents: getEvents } })
        const event = byPubkey[owner]
        if (version !== generation || signal.aborted) return
        if (event?.kind === 3 && event.pubkey === owner && isValidEvent(event)) {
          await eventStore.add(event)
          return
        }
      } catch (error) {
        if (version !== generation || signal.aborted) return
        onError(error)
      }
      if (version !== generation || signal.aborted || lists[0]) return
      const delay = _retryDelays.length ? _retryDelays[Math.min(attempt, _retryDelays.length - 1)] : 0
      attempt++
      const offline = await deviceOffline(signal)
      if (version !== generation || signal.aborted || lists[0]) return
      const backoff = pause(delay, signal).then(() => false)
      if (!offline) await backoff
      else if (await Promise.race([backoff, waitForOnline(signal)])) attempt = 0
    }
  }
  function start () {
    if (starting) return starting
    starting = open().finally(() => { starting = null })
    return starting
  }
  async function open () {
    const version = ++generation
    remote?.abort()
    remote = new AbortController()
    const signal = remote.signal
    const initial = Promise.withResolvers()
    const cancel = () => initial.resolve(false)
    signal.addEventListener('abort', cancel, { once: true })
    let failed = false
    const fail = error => {
      if (version !== generation) return
      failed = true
      loaded = false
      onState('unavailable')
      onError(error)
      initial.resolve(false)
    }
    loaded = false
    onState('loading')
    // Keep displayed contacts until all three local snapshots are decrypted.
    // Neither relay discovery nor message transport readiness gates these reads.
    lists.fill(null)
    for (const stream of streams) stream.return().catch(() => {})
    streams = []
    try {
      context = await signer.obfuscate('', String(PERSONAL_COPY), '')
      if (version !== generation) return false
      coordinates = await Promise.all([[3, ''], [30000, CONTACTS_DTAG]].map(([kind, d]) => signer.obfuscate(`${context}:${kind}:${owner}:${d}`, String(PERSONAL_COPY), '.coordinate')))
      if (version !== generation) return false
      const filters = [
        { kinds: [3], authors: [owner], limit: 1 },
        { kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': ['3'], '#v': ['0', '1'], '#d': [coordinates[0]], limit: 1 },
        { kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': ['30000'], '#v': ['0', '1'], '#d': [coordinates[1]], limit: 1 }
      ]
      const snapshots = new Set()
      for (const [index, filter] of filters.entries()) {
        const stream = eventStore.subscribe(filter, { initial: true })
        streams.push(stream)
        const consume = async () => {
          for await (const item of stream) {
            if (version !== generation) return
            if (item.type === 'eose') {
              snapshots.add(index)
              if (snapshots.size === 3 && !failed && !loaded) {
                loaded = true
                notify()
                onState('loaded')
                initial.resolve(true)
                // A missing public list can recover remotely in the background.
                // A cached list needs no startup relay discovery or retry loop.
                refreshPublicList(version, signal).catch(error => { if (version === generation && !signal.aborted) onError(error) })
              }
              continue
            }
            if (item.type !== 'event') continue
            const event = index ? await decryptPersonalCopy(item.event, { pubkey: owner, signer, encodedContext: context }) : item.event
            if (version !== generation) return
            if (!event || event.pubkey !== owner || (!index && !isValidEvent(event))) continue
            if (index === 2 && !event.tags.some(tag => tag[0] === 'd' && tag[1] === CONTACTS_DTAG)) continue
            lists[index] = preferred(lists[index], event)
            if (loaded) notify()
          }
          if (version === generation && !snapshots.has(index)) throw new Error('CONTACTS_SNAPSHOT_INCOMPLETE')
        }
        consume().catch(fail)
      }
      return await initial.promise
    } catch (error) { fail(error); return false } finally { signal.removeEventListener('abort', cancel) }
  }
  // The override label carries membership and pin. Pin edits require an
  // effective contact and materialize base-list metadata so an entry does not
  // erase the relay hint or petname; removing a contact always clears pin.
  function update (peer, change) {
    if (!hex(peer) || peer === owner) return Promise.reject(new Error('INVALID_CONTACT'))
    const work = writes.catch(() => {}).then(async () => {
      if (!loaded && !await start()) throw new Error('CONTACTS_UNAVAILABLE')
      // Refresh the override before editing; CRDT merging preserves concurrent peers.
      const { results } = await eventStore.query({ kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': ['30000'], '#v': ['0', '1'], '#d': [coordinates[1]], limit: 1 })
      for (const wrapper of results) {
        const value = await decryptPersonalCopy(wrapper, { pubkey: owner, signer, encodedContext: context })
        if (value) lists[2] = preferred(lists[2], value)
      }
      const previous = lists[2]
      const existing = previous?.tags.find(tag => tag[0] === 'p' && tag[1] === peer)
      const existingState = existing ? entryState(existing) : null
      const current = contactMembership(lists, owner).find(contact => contact.pubkey === peer)
      if (change.included === undefined) {
        if (!current) throw new Error('INVALID_CONTACT')
        if (!change.pinned && !existingState?.pinned) return true
      }
      const included = change.included ?? true
      const pinned = included && (change.pinned ?? existingState?.pinned ?? false)
      const tags = (previous?.tags || [['d', CONTACTS_DTAG]]).filter(tag => tag[0] !== 'p' || tag[1] !== peer)
      // Let the store stamp this changed p entry; preserve other entries' CRDT
      // data. Removing always clears pin, and the canonical label never
      // combines 'r' with 'p'.
      tags.push(['p', peer, existingState?.relayHint || current?.relayHint || '', existingState?.petname || current?.petname || '', included ? (pinned ? 'p' : '') : 'r'])
      // Best-effort compaction on every edit. Entries that no longer negate a
      // follow are dropped so the override only carries live decisions.
      const event = { kind: 30000, created_at: Math.max(Math.floor(Date.now() / 1000), (previous?.created_at || 0) + 1), tags: compactContactOverrides(lists, owner, tags), content: previous?.content || '' }
      const result = await eventStore.addPersonalCopy(event, { context: '' })
      if (!result?.result?.ok) throw new Error('CONTACT_STORAGE_FAILED')
      // Read the authoritative merged row on replay; refresh the in-memory snapshot.
      lists[2] = { ...event, pubkey: owner, id: 'f'.repeat(64) }
      notify()
      return true
    })
    writes = work
    return work
  }
  return { start, set: (peer, included) => update(peer, { included }), setPin: (peer, pinned) => update(peer, { pinned }), close () { generation++; remote?.abort(); for (const stream of streams) stream.return().catch(() => {}); streams = [] } }
}
