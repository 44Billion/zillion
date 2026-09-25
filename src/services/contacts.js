import { isOnline } from 'libp2r2p/network'
import { getLatestEventsByPubkey, relayPool } from 'libp2r2p/relay'
import { PERSONAL_COPY } from 'libp2r2p/kind'
import { isValidEvent } from 'libp2r2p/event'
import { decryptPersonalCopy } from './chat-references.js'

export const CONTACTS_DTAG = '+zillion:contacts'
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

export function createContacts ({ owner, signer, eventStore, onChange, onError = () => {} }) {
  const lists = [null, null, null]
  let streams = []
  let generation = 0
  let writes = Promise.resolve()
  let context
  let coordinates
  let starting
  let remote
  const notify = () => onChange(contactMembership(lists, owner))
  function start () {
    if (starting) return starting
    starting = open().finally(() => { starting = null })
    return starting
  }
  async function open () {
    const version = ++generation
    remote?.abort()
    remote = new AbortController()
    const signal = AbortSignal.any([remote.signal, AbortSignal.timeout(15000)])
    // Local snapshots render first. A bounded public-list refresh feeds the
    // same local subscription instead of introducing a second list authority.
    ;(async () => {
      if (!await isOnline({ signal })) return
      const getEvents = (filter, relays, options = {}) => relayPool.getEvents(filter, relays, { ...options, signal })
      const { byPubkey } = await getLatestEventsByPubkey([owner], { kinds: [3], _getEvents: getEvents, relayListOptions: { _getEvents: getEvents } })
      const event = byPubkey[owner]
      if (version === generation && !signal.aborted && event?.kind === 3 && event.pubkey === owner && isValidEvent(event)) await eventStore.add(event)
    })().catch(error => { if (version === generation && !signal.aborted) onError(error) })
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
    // Rebuild each current list from its snapshot, including empty snapshots
    // after a deletion. Keep the displayed directory until all three complete.
    lists.fill(null)
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
