import { PERSONAL_COPY } from 'libp2r2p/kind'
import { createChatWorkers } from './chat-history.js'
import { createChatReferences, decryptPersonalCopy, isResolvableChatReference } from './chat-references.js'
import { chatMessageReferences } from '#helpers/chat-timeline.js'
import { compareChatMessages } from '#helpers/conversation-preview.js'

// The list owns one latest-message snapshot per known conversation, independent
// of the paged histories opened by chat routes. No media bytes are requested.
export function createConversationSummaries ({ pubkey, signer, eventStore, onChange, onError = () => {} }) {
  const entries = new Map()
  const records = new Map()
  const workers = createChatWorkers(4)
  let changes
  let closed = false
  const active = entry => !closed && entries.get(entry.peer) === entry
  const emit = (entry, value) => {
    if (!active(entry)) return
    const record = { ...records.get(entry.peer), ...value }
    records.set(entry.peer, record)
    onChange(entry.peer, record)
  }
  async function latest (entry, first, current) {
    const read = filter => eventStore.query({ ...entry.filter, ...filter })
    let wrapper = first || (await read({ limit: 1 })).results[0]
    while (wrapper && current()) {
      const timestamp = wrapper.created_at
      const seen = new Set()
      let page = [wrapper]
      let best
      let copies = []
      // Wrapper IDs and inner IDs differ. Resolve only the newest timestamp's
      // ties in bounded pages so its preview agrees with the chat's last bubble.
      while (page.length && current()) {
        for (const copy of page) {
          if (!current()) return null
          seen.add(copy.id)
          const event = await decryptPersonalCopy(copy, { pubkey, signer, encodedContext: entry.context, authors: [pubkey, entry.peer] })
          if (event?.kind !== 9) continue
          if (!best || compareChatMessages(event, best) > 0) { best = event; copies = [] }
          if (event.id === best.id) copies.push({ id: copy.id, created_at: copy.created_at })
        }
        if (!current()) return null
        page = (await read({ since: timestamp, until: timestamp, '!ids': [...seen], limit: 16 })).results
      }
      if (best) return { event: best, copies }
      if (!current() || timestamp === 0) return null
      // An invalid wrapper does not hide the latest valid local message.
      wrapper = (await read({ until: timestamp - 1, limit: 1 })).results[0]
    }
    return null
  }
  function refresh (entry, first) {
    entry.revision++
    entry.dirty = true
    entry.first = first
    if (entry.work) return entry.work
    entry.work = workers(async () => {
      while (active(entry) && entry.dirty) {
        entry.dirty = false
        const revision = entry.revision
        const current = () => active(entry) && entry.revision === revision
        try {
          const { event = null, copies = [] } = await latest(entry, entry.first, current) || {}
          const references = {}
          // Point lookups only, with the same personal-copy admission as chat.
          const reader = createChatReferences({ pubkey, signer, eventStore, context: `dm:${entry.peer}` })
          for (const reference of chatMessageReferences(event).references) {
            if (!current()) break
            if (!isResolvableChatReference(reference)) continue
            const resolved = await reader.prepare(reference)
            if (resolved) references[reference.id] = resolved
          }
          reader.clear()
          if (current()) emit(entry, { event, copies, references, state: 'loaded' })
        } catch (error) {
          if (current()) { emit(entry, { state: 'unavailable' }); onError(error) }
        }
      }
    }).finally(() => { entry.work = null; if (active(entry) && entry.dirty) refresh(entry, entry.first); else entry.ready.resolve() })
    return entry.work
  }
  function watchChanges () {
    if (changes) return
    const stream = changes = eventStore.subscribe({ kinds: [PERSONAL_COPY], authors: [pubkey], '#k': ['5', '1063'], '#v': ['0', '1', '2'] })
    ;(async () => {
      for await (const item of stream) {
        if (closed || changes !== stream) return
        if (item.type !== 'event') continue
        const context = item.event.tags.find(tag => tag[0] === 'c')?.[1]
        for (const entry of entries.values()) {
          if (entry.context !== context) continue
          if (entry.initial) refresh(entry)
          else entry.invalidated = true
        }
      }
    })().catch(error => { if (!closed && changes === stream) onError(error) })
  }
  function open (peer) {
    const entry = { peer, ready: Promise.withResolvers(), revision: 0, initial: false }
    entries.set(peer, entry)
    emit(entry, { state: 'loading' })
    workers(async () => {
      entry.context = await signer.obfuscate(`dm:${peer}`, String(PERSONAL_COPY), '')
      if (!active(entry)) return
      entry.filter = { kinds: [PERSONAL_COPY], authors: [pubkey], '#k': ['9'], '#c': [entry.context], '#v': ['0', '1'] }
      const stream = entry.stream = eventStore.subscribe({ ...entry.filter, limit: 1 }, { initial: true })
      ;(async () => {
        let first
        for await (const item of stream) {
          if (!active(entry)) return
          if (item.type === 'eose') { entry.initial = true; refresh(entry, entry.invalidated ? undefined : first) }
          if (item.type !== 'event') continue
          if (!entry.initial) first = item.event
          else if (entry.work || !records.get(peer)?.event || item.event.created_at >= records.get(peer).event.created_at) refresh(entry)
        }
        if (active(entry)) throw new Error('CONVERSATION_SUMMARY_CLOSED')
      })().catch(error => { if (active(entry)) { emit(entry, { state: 'unavailable' }); entry.ready.resolve(); onError(error) } })
    }).catch(error => { if (active(entry)) { emit(entry, { state: 'unavailable' }); entry.ready.resolve(); onError(error) } })
    return entry
  }
  function stop (entry) {
    entries.delete(entry.peer)
    entry.stream?.return().catch(() => {})
    entry.ready.resolve()
  }
  function setPeers (peers) {
    if (closed) return Promise.resolve()
    watchChanges()
    const wanted = new Set([pubkey, ...peers].filter(peer => /^[0-9a-f]{64}$/.test(peer)))
    for (const [peer, entry] of entries) if (!wanted.has(peer)) { stop(entry); records.delete(peer); onChange(peer, null) }
    for (const peer of wanted) if (!entries.has(peer)) open(peer)
    return Promise.all([...entries.values()].map(entry => entry.ready.promise))
  }
  return {
    setPeers,
    recover () {
      const peers = [...entries.keys()]
      for (const entry of entries.values()) stop(entry)
      changes?.return().catch(() => {}); changes = null
      return setPeers(peers)
    },
    close () { closed = true; for (const entry of entries.values()) stop(entry); changes?.return().catch(() => {}); changes = null; records.clear() }
  }
}
