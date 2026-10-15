import { PERSONAL_COPY } from 'libp2r2p/kind'
import { createChatWorkers } from './chat-history.js'
import { createChatReferences, decryptPersonalCopy, isResolvableChatReference } from './chat-references.js'
import { chatMessageReferences } from '#helpers/chat-timeline.js'
import { compareChatMessages } from '#helpers/conversation-preview.js'
import { createConversationSummaryCache } from './conversation-summary-cache.js'
import { getHomeCacheTimeout } from '#helpers/home-cache.js'

// The list owns one latest-message snapshot per known conversation, independent
// of the paged histories opened by chat routes. No media bytes are requested.
export function createConversationSummaries ({ pubkey, signer, eventStore, onChange, onRestore, onError = () => {}, cache = globalThis.indexedDB ? createConversationSummaryCache({ owner: pubkey, signer }) : null, cacheTimeout = getHomeCacheTimeout() }) {
  const entries = new Map()
  const records = new Map()
  const workers = createChatWorkers(4)
  let changes
  let closed = false
  let wanted
  let bootstrap
  let bootstrapFailed = false
  let cacheValues
  let cacheGeneration = 0
  let saveTimer
  let saving
  let dirty = false
  let hadProjection = false
  const projection = new Map()
  const active = entry => !closed && entries.get(entry.peer) === entry
  const emit = (entry, value) => {
    if (!active(entry)) return
    const record = { ...records.get(entry.peer), ...value }
    records.set(entry.peer, record)
    onChange(entry.peer, record)
  }
  function scheduleSave () {
    if (!cache || closed) return
    if (!projection.size && !hadProjection) return
    hadProjection = true
    dirty = true
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => flush().catch(onError), 250)
  }
  function flush () {
    clearTimeout(saveTimer)
    if (!cache || !dirty) return saving || Promise.resolve()
    if (saving) return saving.then(flush)
    dirty = false
    const records = [...projection].map(([peer, record]) => ({ ...record, peer }))
    saving = cache.write(records).catch(error => { onError(error) }).finally(() => { saving = null })
    return saving
  }
  function applyCache () {
    if (closed || !wanted || !cacheValues) return
    const values = cacheValues
    cacheValues = null
    const restored = {}
    for (const { peer, ...value } of values) {
      const previous = records.get(peer)
      if (!wanted.has(peer) || previous?.messageReady || (previous?.event && compareChatMessages(previous.event, value.event) > 0)) continue
      const record = { ...value, state: 'cached', verified: false, messageReady: false }
      records.set(peer, record); projection.set(peer, value); restored[peer] = record
    }
    if (onRestore) onRestore(restored)
    else for (const [peer, value] of Object.entries(restored)) onChange(peer, value)
    // A late snapshot can become eligible independently of source delivery.
    for (const peer of Object.keys(restored)) {
      const entry = entries.get(peer)
      if (entry?.filter) admitCache(entry).catch(error => { if (active(entry)) onError(error) })
    }
  }
  // Start after unlock, without requiring contact membership or source readers.
  // The single budget starts here; confirming contacts cannot restart it.
  function prepare () {
    if (closed || !cache) return Promise.resolve()
    if (bootstrap) return bootstrap.ready.promise
    const attempt = bootstrap = { ready: Promise.withResolvers() }
    const generation = cacheGeneration
    const current = () => !closed && generation === cacheGeneration
    const finish = () => { clearTimeout(attempt.timer); attempt.ready.resolve() }
    attempt.timer = setTimeout(finish, cacheTimeout)
    Promise.resolve().then(() => current() ? cache.read() : []).then(values => {
      if (!current()) return
      bootstrapFailed = false
      if (values.length) hadProjection = true
      cacheValues = values
      applyCache()
    }).catch(error => { if (current()) { bootstrapFailed = true; onError(error) } }).finally(finish)
    return attempt.ready.promise
  }
  function suspend () {
    cacheGeneration++
    clearTimeout(bootstrap?.timer)
    bootstrap?.ready.resolve()
    bootstrap = null; cacheValues = null; wanted = null
    bootstrapFailed = false
  }
  // Existence checks use the exact source IDs, account and conversation. They
  // admit cached plaintext without repeating its signer decryption, and never
  // let a deleted copy become a foreground bubble or prefetch seed.
  async function admitCache (entry) {
    const record = records.get(entry.peer)
    if (!record?.event || record.verified !== false) return
    const revision = entry.revision
    const present = new Set()
    const { results: main } = await eventStore.query({ ...entry.filter, ids: record.copies.map(copy => copy.id), ids_only: true, limit: 32 })
    for (const id of main) present.add(id)
    const personal = Object.values(record.sources || {}).filter(source => source.personal).flatMap(source => source.ids)
    for (let offset = 0; offset < personal.length; offset += 200) {
      const kinds = ['9', ...Object.entries(record.sources || {}).filter(([, source]) => source.personal).map(([id]) => String(record.references[id].kind))]
      const { results } = await eventStore.query({ kinds: [PERSONAL_COPY], authors: [pubkey], '#k': [...new Set(kinds)], '#c': [entry.context], '#v': ['0', '1', '2'], ids: personal.slice(offset, offset + 200), ids_only: true, limit: 200 })
      for (const id of results) present.add(id)
    }
    for (const [id, source] of Object.entries(record.sources || {})) {
      if (source.personal) continue
      const { results } = await eventStore.query({ kinds: [record.references[id].kind], ids: source.ids, ids_only: true, limit: 32 })
      for (const value of results) present.add(value)
    }
    const currentRecord = records.get(entry.peer)
    if (!active(entry) || entry.revision !== revision || currentRecord?.verified !== false || currentRecord.event?.id !== record.event.id) return
    const copies = record.copies.filter(copy => present.has(copy.id))
    const references = {}
    const sources = {}
    for (const [id, source] of Object.entries(record.sources || {})) {
      if (!source.ids.some(value => present.has(value))) continue
      references[id] = record.references[id]; sources[id] = source
    }
    if (copies.length) {
      for (const copy of copies) entry.admitted.set(copy.id, record.event)
      entry.references = references; entry.sources = sources
      emit(entry, { copies, references, sources, verified: true })
    } else {
      projection.delete(entry.peer); scheduleSave()
      emit(entry, { event: null, copies: [], references: {}, sources: {}, verified: false })
    }
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
          const event = entry.admitted.get(copy.id) || await decryptPersonalCopy(copy, { pubkey, signer, encodedContext: entry.context, authors: [pubkey, entry.peer] })
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
          if (!current()) continue
          entry.admitted.clear()
          for (const copy of copies) entry.admitted.set(copy.id, event)
          const references = {}
          const sources = {}
          // The event and timestamp are already authoritative. Publish them
          // before slower quote/file metadata; the preview has semantic fallbacks.
          const reusable = event?.id === records.get(entry.peer)?.event?.id
          emit(entry, { event, copies, references: reusable ? entry.references : {}, sources: reusable ? entry.sources : {}, verified: true, messageReady: true, state: 'loading' })
          if (event) projection.set(entry.peer, { context: entry.context, event, copies, references: reusable ? entry.references : {}, sources: reusable ? entry.sources : {} })
          else projection.delete(entry.peer)
          scheduleSave()
          // Point lookups only, with the same personal-copy admission as chat.
          const reader = createChatReferences({ pubkey, signer, eventStore, context: `dm:${entry.peer}` })
          reader.seed(Object.values(entry.references), entry.sources)
          for (const reference of chatMessageReferences(event).references) {
            if (!current()) break
            if (!isResolvableChatReference(reference)) continue
            const resolved = await reader.prepare(reference)
            if (resolved) { references[reference.id] = resolved; sources[reference.id] = reader.source(reference.id) }
          }
          reader.clear()
          if (current()) {
            entry.references = references; entry.sources = sources
            emit(entry, { event, copies, references, sources, verified: true, messageReady: true, state: 'loaded' })
            if (event) projection.set(entry.peer, { context: entry.context, event, copies, references, sources })
            else projection.delete(entry.peer)
            scheduleSave()
          }
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
          entry.references = {}; entry.sources = {}
          if (entry.initial) refresh(entry)
          else { entry.revision++; entry.invalidated = true }
        }
      }
    })().catch(error => { if (!closed && changes === stream) onError(error) })
  }
  function open (peer) {
    const entry = { peer, ready: Promise.withResolvers(), revision: 0, initial: false, admitted: new Map(), references: {}, sources: {} }
    entries.set(peer, entry)
    emit(entry, { state: records.get(peer)?.event ? 'cached' : 'loading', messageReady: false })
    workers(async () => {
      entry.context = records.get(peer)?.context || await signer.obfuscate(`dm:${peer}`, String(PERSONAL_COPY), '')
      if (!active(entry)) return
      entry.filter = { kinds: [PERSONAL_COPY], authors: [pubkey], '#k': ['9'], '#c': [entry.context], '#v': ['0', '1'] }
      const stream = entry.stream = eventStore.subscribe({ ...entry.filter, limit: 1 }, { initial: true })
      const admission = admitCache(entry).catch(error => { if (active(entry)) onError(error) })
      ;(async () => {
        let first
        for await (const item of stream) {
          if (!active(entry)) return
          if (item.type === 'eose') {
            await admission
            if (!active(entry)) return
            entry.initial = true; refresh(entry, entry.invalidated ? undefined : first)
          }
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
  async function setPeers (peers) {
    if (closed) return
    wanted = new Set([pubkey, ...peers].filter(peer => /^[0-9a-f]{64}$/.test(peer)))
    const generation = cacheGeneration
    const prepared = prepare()
    applyCache()
    await prepared
    if (closed || generation !== cacheGeneration) return
    applyCache()
    watchChanges()
    for (const [peer, entry] of entries) if (!wanted.has(peer)) { stop(entry); records.delete(peer); projection.delete(peer); onChange(peer, null); scheduleSave() }
    for (const peer of records.keys()) if (!wanted.has(peer)) { records.delete(peer); projection.delete(peer); onChange(peer, null) }
    for (const peer of wanted) if (!entries.has(peer)) open(peer)
    return Promise.all([...entries.values()].map(entry => entry.ready.promise))
  }
  return {
    prepare,
    suspend,
    setPeers,
    flush,
    recover (peers = [...entries.keys()]) {
      if (closed) return Promise.resolve()
      for (const entry of entries.values()) stop(entry)
      changes?.return().catch(() => {}); changes = null
      if (bootstrapFailed) { bootstrap = null; cacheValues = null }
      return setPeers(peers)
    },
    async close () {
      closed = true; suspend(); clearTimeout(saveTimer)
      for (const entry of entries.values()) stop(entry)
      changes?.return().catch(() => {}); changes = null; records.clear()
      await flush()
      await cache?.close()
    }
  }
}
