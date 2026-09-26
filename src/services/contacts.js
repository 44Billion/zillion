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
export function contactMembership (lists, owner) {
  const contacts = new Map()
  for (const event of lists.slice(0, 2)) {
    if (event?.pubkey !== owner) continue
    for (const tag of event.tags) if (tag[0] === 'p' && hex(tag[1]) && tag[1] !== owner) contacts.set(tag[1], { pubkey: tag[1], relayHint: tag[2] || '', petname: tag[3]?.startsWith('~') ? '' : tag[3] || '' })
  }
  const overrides = lists[2]
  if (overrides?.pubkey === owner) {
    for (const tag of overrides.tags) {
      if (tag[0] !== 'p' || !hex(tag[1]) || tag[1] === owner) continue
      if (tag[4] === '0') contacts.delete(tag[1])
      else if (tag[4] == null || tag[4] === '1' || tag[4].startsWith('~')) contacts.set(tag[1], { pubkey: tag[1], relayHint: tag[2] || '', petname: tag[3]?.startsWith('~') ? '' : tag[3] || '' })
    }
  }
  return [...contacts.values()]
}

export function createContacts ({ owner, signer, eventStore, onChange, onError = () => {}, _getEvents, _retryDelays = CONTACTS_REFRESH_DELAYS, _isOnline = isOnline, _onOnline = onOnline }) {
  const lists = [null, null, null]
  let streams = []
  let generation = 0
  let writes = Promise.resolve()
  let context
  let coordinates
  let starting
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
    // Rebuild each current list from its snapshot, including empty snapshots
    // after a deletion. Keep the displayed directory until all three complete.
    lists.fill(null)
    // Local snapshots render first. A bounded public-list refresh feeds the
    // same local subscription instead of introducing a second list authority.
    // Generic connectivity probes must not gate relays, and the refresh keeps
    // retrying with backoff while no local public list is known.
    refreshPublicList(version, signal).catch(error => { if (version === generation && !signal.aborted) onError(error) })
    for (const stream of streams) stream.return().catch(() => {})
    streams = []
    context = await signer.obfuscate('', String(PERSONAL_COPY), '')
    if (version !== generation) return
    coordinates = await Promise.all([[3, ''], [30000, CONTACTS_DTAG]].map(([kind, d]) => signer.obfuscate(`${context}:${kind}:${owner}:${d}`, String(PERSONAL_COPY), '.coordinate')))
    const filters = [
      { kinds: [3], authors: [owner], limit: 1 },
      { kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': ['3'], '#v': ['0', '1'], '#d': [coordinates[0]], limit: 1 },
      { kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': ['30000'], '#v': ['0', '1'], '#d': [coordinates[1]], limit: 1 }
    ]
    if (version !== generation) return
    const snapshots = new Set()
    await Promise.all(filters.map(async (filter, index) => {
      const stream = eventStore.subscribe(filter, { initial: true })
      streams.push(stream)
      const consume = async () => {
        for await (const item of stream) {
          if (version !== generation) return
          if (item.type === 'eose') { snapshots.add(index); if (snapshots.size === 3) notify(); continue }
          if (item.type !== 'event') continue
          const event = index ? await decryptPersonalCopy(item.event, { pubkey: owner, signer, encodedContext: context }) : item.event
          if (version !== generation) return
          if (!event || event.pubkey !== owner || (!index && !isValidEvent(event))) continue
          if (index === 2 && !event.tags.some(tag => tag[0] === 'd' && tag[1] === CONTACTS_DTAG)) continue
          lists[index] = preferred(lists[index], event)
          if (snapshots.size === 3) notify()
        }
      }
      consume().catch(error => { if (version === generation) onError(error) })
    }))
  }
  function set (peer, included) {
    if (!hex(peer) || peer === owner) return Promise.reject(new Error('INVALID_CONTACT'))
    const work = writes.catch(() => {}).then(async () => {
      if (!coordinates) await start()
      // Refresh the override before editing; CRDT merging preserves concurrent peers.
      const { results } = await eventStore.query({ kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': ['30000'], '#v': ['0', '1'], '#d': [coordinates[1]], limit: 1 })
      for (const wrapper of results) {
        const value = await decryptPersonalCopy(wrapper, { pubkey: owner, signer, encodedContext: context })
        if (value) lists[2] = preferred(lists[2], value)
      }
      const previous = lists[2]
      const existing = previous?.tags.find(tag => tag[0] === 'p' && tag[1] === peer)
      const tags = (previous?.tags || [['d', CONTACTS_DTAG]]).filter(tag => tag[0] !== 'p' || tag[1] !== peer)
      // Let the store stamp this changed p entry; preserve other entries' CRDT data.
      tags.push(['p', peer, existing?.[2] || '', existing?.[3]?.startsWith('~') ? '' : existing?.[3] || '', included ? '1' : '0'])
      const event = { kind: 30000, created_at: Math.max(Math.floor(Date.now() / 1000), (previous?.created_at || 0) + 1), tags, content: previous?.content || '' }
      const result = await eventStore.addPersonalCopy(event, { context: '' })
      if (!result?.result?.ok) throw new Error('CONTACT_STORAGE_FAILED')
      // Read the authoritative merged row on replay; update membership immediately.
      lists[2] = { ...event, pubkey: owner, id: 'f'.repeat(64) }
      notify()
      return true
    })
    writes = work
    return work
  }
  return { start, set, close () { generation++; remote?.abort(); for (const stream of streams) stream.return().catch(() => {}); streams = [] } }
}
