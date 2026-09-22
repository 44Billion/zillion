import { createChatHistory, createChatWorkers } from './chat-history.js'
import { createConversationMediaReader } from './conversation-media.js'
import { encodedFileName } from '#helpers/attachment-presentation.js'
import { parseChatContent } from '#helpers/chat-content.js'
import { getRandomId } from '#helpers/random-id.js'
import { nfileEncode } from 'libp2r2p/nip19'
import { decodeIrfsChunk } from 'libp2r2p/irfs'
import { getEventHash } from 'libp2r2p/event'
import { createFileMetadata } from 'libp2r2p/nip94'
import { verifyLocalFile } from './chat-attachments.js'
import { PERSONAL_COPY } from 'libp2r2p/kind'
import { compactWhitespace } from 'libp2r2p/nip27'
import { chatReferenceUri, createChatReferences, decryptPersonalCopy, CHAT_FILE_KIND, CHAT_TEXT_KIND } from './chat-references.js'

export const SELF_CHAT_KIND = 9
export const DELETION_KIND = 5

const MAX_SALT_ATTEMPTS = 128
const SALT_SEARCH_MS = 4

// Oldest first: the reverse of NIP-01's newest-first, lowest-ID-first order.
function compareMessages (a, b) {
  return a.created_at - b.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
}

// The launcher owns encryption, signing and persistence. This service only
// interprets its personal-copy contract for the primary user's own chat.
export function createSelfChat ({ pubkey, eventStore, signer, onMessages, onError, onReference = () => {}, onDelete = () => {}, onInitialLoad = () => {}, onHistoryState = () => {}, onOlderState = () => {}, verifyFile = verifyLocalFile }) {
  const context = `dm:${pubkey}`
  const references = createChatReferences({ pubkey, eventStore, signer, context, onResolved: onReference })
  const catalog = createChatReferences({ pubkey, eventStore, signer, context: '' })
  const catalogWrites = new Map()
  const messages = new Map()
  const deleted = new Set()
  const outbox = new Map()
  const controller = new AbortController()
  let closed = false
  const retained = new Map()
  const workers = createChatWorkers()
  let history
  let deletionSubscription
  let generation = 0
  let loading
  // Include pending/failed sends and observed history. Deletion must not move
  // this cursor backwards while the account service remains alive.
  let latest
  const rememberOrder = event => {
    if (!latest || compareMessages(latest, event) < 0) latest = { id: event.id, created_at: event.created_at }
  }
  const emit = () => {
    if (!closed) onMessages([...messages.values()].sort(compareMessages))
  }
  const confirm = (id, event, notify = true) => {
    if (closed || deleted.has(id) || messages.get(id)?.status === 'saved') return
    rememberOrder({ ...event, id })
    messages.set(id, { ...event, id, status: 'saved' })
    outbox.get(id)?.attachment?.close?.()
    outbox.delete(id)
    if (notify) emit()
  }
  async function accept (wrapper, filter, current) {
    if (!current()) return
    const event = await decryptPersonalCopy(wrapper, { pubkey, signer, encodedContext: filter['#c'][0] })
    if (!current()) return
    if (!event || event.kind !== CHAT_TEXT_KIND) return
    confirm(event.id, event, false)
    // A message may have arrived before the personal copy it references, and a
    // missed lookup is cached. Revalidate misses as new copies land.
    references.retryMisses()
    return event.id
  }
  // A private deletion request is an ordinary personal copy whose inner is a
  // kind-5 event; the store applies it, and this subscription keeps the
  // in-memory list in step with removals that arrived from other devices.
  async function acceptDeletion (wrapper, filter, current) {
    if (!current()) return
    const event = await decryptPersonalCopy(wrapper, { pubkey, signer, encodedContext: filter['#c'][0] })
    if (!current() || !event || event.kind !== DELETION_KIND) return
    const ids = event.tags
      .filter(tag => tag?.[0] === 'e' && typeof tag[1] === 'string')
      .map(tag => tag[1])
    if (ids.length > 0) remove(ids)
  }
  function remove (ids) {
    for (const id of ids) {
      deleted.add(id)
      messages.delete(id)
      outbox.get(id)?.attachment?.close?.()
      outbox.delete(id)
    }
    references.remove(ids)
    onDelete(ids)
    emit()
  }
  function saveCatalogFile (event, metadata) {
    if (!/^(image|video)\//.test(metadata.mime)) return Promise.resolve()
    const { root } = metadata
    if (catalogWrites.has(root)) return catalogWrites.get(root)
    const save = async () => {
      controller.signal.throwIfAborted()
      if ((await catalog.readFiles({ root, limit: 1 })).length) return
      controller.signal.throwIfAborted()
      const saved = await eventStore.addPersonalCopy(event, { context: '' })
      if (!saved?.result?.ok) throw new Error(`Catalog storage failed: ${saved?.result?.code ?? 'unknown'}`)
    }
    // Serialize the check/write across sends and same-origin app instances.
    const work = Promise.resolve().then(() => globalThis.navigator?.locks
      ? navigator.locks.request(`zillion:catalog:${pubkey}:${root}`, { signal: controller.signal }, save)
      : save()).finally(() => catalogWrites.delete(root))
    catalogWrites.set(root, work)
    return work
  }
  function start () {
    if (closed) return Promise.resolve(false)
    if (loading) return loading
    const version = ++generation
    const current = () => !closed && generation === version
    history?.close()
    history = null
    const previousDeletions = deletionSubscription
    deletionSubscription = null
    previousDeletions?.return().catch(() => {})
    onHistoryState('loading')
    const fail = error => {
      if (!current()) return
      generation++
      history?.close()
      deletionSubscription?.return().catch(() => {})
      onHistoryState('unavailable')
      onError(error)
    }
    loading = (async () => {
      try {
        const encodedContext = await signer.obfuscate(context, String(PERSONAL_COPY), '')
        if (!current()) return false
        // The feed is driven by kind 9 messages only. File metadata (1063) is
        // fetched lazily through the references of those messages.
        const filter = { kinds: [PERSONAL_COPY], authors: [pubkey], '#k': ['9'], '#c': [encodedContext], '#v': ['0', '1'] }
        // The envelope's inner carries `k` tags for the kinds it targets; those
        // values are mirrored into `o`, so the subscription only decrypts
        // deletions that can affect chat messages or their file metadata. The
        // narrowing is an optimization: if the signer cannot derive the extra
        // scopes, keep the broader envelope subscription instead of failing.
        let deletionFilter = {
          kinds: [PERSONAL_COPY],
          authors: [pubkey],
          '#k': [String(DELETION_KIND)],
          '#c': [encodedContext],
          '#v': ['0', '1']
        }
        try {
          const deletionKindMirrors = await Promise.all([CHAT_TEXT_KIND, CHAT_FILE_KIND].map(kind =>
            signer.obfuscate(String(kind), String(PERSONAL_COPY), '#k')
          ))
          deletionFilter = { ...deletionFilter, '#o': deletionKindMirrors }
        } catch {
          // Keep deletion tracking even without the optional kind mirrors.
        }
        const deletions = eventStore.subscribe(deletionFilter)
        deletionSubscription = deletions
        const deletionLive = (async () => {
          for await (const item of deletions) {
            if (item.type !== 'event') continue
            if (!current()) return
            await workers(() => acceptDeletion(item.event, deletionFilter, current))
          }
        })()
        deletionLive.catch(fail)
        if (!current()) return false
        history = createChatHistory({
          eventStore, filter, retained, workers,
          accept: (wrapper, active) => accept(wrapper, filter, () => current() && active()),
          onMissing: id => remove([id]), onBatch: emit,
          onState: onOlderState, onError: fail
        })
        const loaded = await history.start()
        if (!current() || !loaded) return false
        onInitialLoad()
        onHistoryState('loaded')
        return true
      } catch (error) { fail(error); return false }
    })().finally(() => { loading = null })
    return loading
  }
  function write (id) {
    const entry = outbox.get(id)
    if (closed || !entry) return Promise.resolve()
    if (entry.work) return entry.work
    messages.set(id, { ...messages.get(id), status: 'pending' })
    emit()
    entry.work = Promise.resolve().then(async () => {
      if (closed) return
      if (entry.attachment) {
        const { prepared, metadata } = entry.attachment
        if (prepared) {
          // Each batch settles before the next is constructed. No unbounded
          // queue of encoded chunks, and retries retain the original template.
          let batch = []
          const saveChunk = async chunk => {
            controller.signal.throwIfAborted()
            const d = chunk.tags.find(tag => tag[0] === 'd')[1]
            const existing = await eventStore.query({ kinds: [34601], '#d': [d], limit: 1 })
            if (existing.results?.some(event => {
              try { return decodeIrfsChunk(event).root === metadata.root } catch { return false }
            })) return
            const saved = await eventStore.addPersonalCopy(chunk, { context })
            if (!saved?.result?.ok) throw new Error(`Chunk storage failed: ${saved?.result?.code ?? 'unknown'}`)
          }
          const settle = async () => {
            const results = await Promise.all(batch)
            batch = []
            const failed = results.find(result => result.status === 'rejected')
            if (failed) throw failed.reason
          }
          for await (const chunk of prepared.chunks({ created_at: entry.event.created_at, signal: controller.signal })) {
            batch.push(saveChunk(chunk).then(() => ({ status: 'fulfilled' }), reason => ({ status: 'rejected', reason })))
            if (batch.length === 3) await settle()
          }
          await settle()
        }
        await verifyFile(metadata, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]) })
        controller.signal.throwIfAborted()
      }
      // The file metadata is committed before the kind 9 that references it.
      if (entry.fileEvent) {
        const savedFile = await eventStore.addPersonalCopy(entry.fileEvent, { context })
        if (!savedFile?.result?.ok) throw new Error(`File storage failed: ${savedFile?.result?.code ?? 'unknown'}`)
        await saveCatalogFile(entry.fileEvent, entry.attachment.metadata)
      }
      controller.signal.throwIfAborted()
      const saved = await eventStore.addPersonalCopy(entry.event, { context })
      if (!saved?.result?.ok) throw new Error(`Message storage failed: ${saved?.result?.code ?? 'unknown'}`)
      confirm(id, { ...entry.event, pubkey })
    }).catch(() => {
      // A confirmed subscription result wins over a late write rejection.
      if (closed || outbox.get(id) !== entry) return
      messages.set(id, { ...messages.get(id), status: 'error' })
      emit()
    }).finally(() => { entry.work = null })
    return entry.work
  }
  function send (content, replyTo, attachment) {
    if (closed) throw new Error('Self chat is closed')
    if (typeof content !== 'string' || (!content.trim() && !attachment)) return
    content = compactWhitespace(content)
    if (!content && !attachment) return
    if (replyTo && !messages.has(replyTo)) throw new Error('Unknown reply target')
    const createdAt = Math.max(Math.floor(Date.now() / 1000), latest?.created_at ?? 0)
    const reply = replyTo ? messages.get(replyTo) : null
    if (attachment) {
      const { root, mime, size, width, height, thumbhash } = attachment.metadata
      const filename = encodedFileName(attachment.metadata)
      const url = `https://nostr.alt/${nfileEncode({ root, mime, filename })}?localOnly=1`
      attachment = { ...attachment, metadata: { root, mime, size, width, height, thumbhash, filename, url, service: 'irfs' } }
    }
    const fileSalt = attachment ? getRandomId() : null
    const saltTag = ['salt', getRandomId()]
    let fileEvent = null
    const buildEvent = createdAt => {
      const tags = reply ? [['q', reply.id, '', pubkey]] : []
      // NIP-21 URIs come first: the replied kind 9, then the attached 1063.
      // Rebuild the file ID and both pointers if the timestamp must advance.
      const uris = reply ? [chatReferenceUri(reply)] : []
      if (attachment) {
        fileEvent = createFileMetadata({ ...attachment.metadata, caption: content, created_at: createdAt, tags: [['salt', fileSalt]] })
        const file = { ...fileEvent, pubkey, id: getEventHash({ ...fileEvent, pubkey }) }
        tags.push(['q', file.id, '', pubkey])
        uris.push(chatReferenceUri(file))
      }
      return {
        kind: SELF_CHAT_KIND,
        created_at: createdAt,
        content: [...uris, attachment ? '' : content].filter(Boolean).join('\n'),
        tags: [...tags, saltTag]
      }
    }
    let event = buildEvent(createdAt)
    const started = performance.now()
    let id = getEventHash({ ...event, pubkey })
    for (let attempts = 1; latest?.created_at === createdAt && id >= latest.id; attempts++) {
      if (attempts >= MAX_SALT_ATTEMPTS || performance.now() - started >= SALT_SEARCH_MS) {
        // No waiting or unbounded hashing. Advance beyond the effective second,
        // including earlier sends that already moved ahead of the wall clock.
        event = buildEvent(createdAt + 1)
        id = getEventHash({ ...event, pubkey })
        break
      }
      saltTag[1] = getRandomId()
      id = getEventHash({ ...event, pubkey })
    }
    rememberOrder({ ...event, id })
    messages.set(id, { ...event, pubkey, id, status: 'pending', localSource: attachment?.source, localAttachment: attachment?.metadata })
    if (fileEvent) {
      const fileId = getEventHash({ ...fileEvent, pubkey })
      references.locals.set(fileId, { ...fileEvent, pubkey, id: fileId })
    }
    references.locals.set(id, { ...event, pubkey, id })
    outbox.set(id, { event, fileEvent, attachment, work: null })
    write(id)
    return id
  }
  function close () {
    closed = true
    generation++
    controller.abort()
    for (const entry of outbox.values()) entry.attachment?.close?.()
    outbox.clear()
    references.clear()
    catalog.clear()
    history?.close()
    deletionSubscription?.return().catch(() => {})
  }

  // Delete the message and its direct attachment only in the conversation.
  // The independent catalog copy and quoted messages keep their own lifetime.
  function deleteMessage (id) {
    if (closed) throw new Error('Self chat is closed')
    const message = messages.get(id)
    if (!message || message.status !== 'saved') return Promise.resolve(false)
    messages.delete(id)
    emit()
    const quoted = new Set(message.tags.filter(tag => tag[0] === 'q' && tag[3] === pubkey).map(tag => tag[1]))
    const files = [...new Set(parseChatContent(message.content)
      .filter(part => part.key === 'event' && part.event.kind === CHAT_FILE_KIND && part.event.author === pubkey && quoted.has(part.event.id))
      .map(part => part.event.id))]
    const request = {
      kind: DELETION_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['e', id], ...files.map(fileId => ['e', fileId]), ['k', String(message.kind ?? SELF_CHAT_KIND)], ...(files.length ? [['k', String(CHAT_FILE_KIND)]] : [])],
      content: ''
    }
    return Promise.resolve().then(() => eventStore.addPersonalCopy(request, { context }))
      .then(result => result?.result?.ok === true)
      .catch(error => { onError(error); return false })
      .then(saved => {
        if (saved) { if (!closed) remove([id, ...files]); return true }
        if (!closed && !deleted.has(id) && !messages.has(id)) { messages.set(id, message); emit() }
        return false
      })
  }
  return {
    start,
    loadOlder: () => history?.loadOlder() ?? Promise.resolve(false),
    send,
    deleteMessage,
    retry: write,
    close,
    // Pending/local events and store lookups share one resolver.
    resolveReference: reference => references.prepare(reference),
    readFiles: options => catalog.readFiles(options),
    createMediaReader: options => createConversationMediaReader({ ...options, pubkey, signer, eventStore, context })
  }
}
