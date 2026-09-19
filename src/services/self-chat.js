import { encodedFileName } from '#helpers/attachment-presentation.js'
import { nfileEncode } from 'libp2r2p/nip19'
import { decodeIrfsChunk } from 'libp2r2p/irfs'
import { getEventHash } from 'libp2r2p/event'
import { createFileMetadata } from 'libp2r2p/nip94'
import { verifyLocalFile } from './chat-attachments.js'
import { PERSONAL_COPY } from 'libp2r2p/kind'
import { compactWhitespace } from 'libp2r2p/nip27'
import { chatReferenceUri, createChatReferences, decryptPersonalCopy, CHAT_TEXT_KIND } from './chat-references.js'

export const SELF_CHAT_KIND = 9
export const DELETION_KIND = 5

// The launcher owns encryption, signing and persistence. This service only
// interprets its personal-copy contract for the primary user's own chat.
export function createSelfChat ({ pubkey, eventStore, signer, onMessages, onError, onReference = () => {}, onDelete = () => {}, onInitialLoad = () => {}, onHistoryState = () => {}, verifyFile = verifyLocalFile }) {
  const context = `dm:${pubkey}`
  const references = createChatReferences({ pubkey, eventStore, signer, context, onResolved: onReference })
  const messages = new Map()
  const outbox = new Map()
  const controller = new AbortController()
  let closed = false
  let subscription
  let deletionSubscription
  let generation = 0
  let loading
  const emit = () => {
    if (!closed) onMessages([...messages.values()].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)))
  }
  const confirm = (id, event) => {
    if (closed || messages.get(id)?.status === 'saved') return
    messages.set(id, { ...event, id, status: 'saved' })
    outbox.get(id)?.attachment?.close?.()
    outbox.delete(id)
    emit()
  }
  async function accept (wrapper, filter, current) {
    if (!current()) return
    const event = await decryptPersonalCopy(wrapper, { pubkey, signer, encodedContext: filter['#c'][0] })
    if (!current()) return
    if (!event || event.kind !== CHAT_TEXT_KIND) return
    confirm(event.id, event)
    // A message may have arrived before the personal copy it references, and a
    // missed lookup is cached. Revalidate misses as new copies land.
    references.retryMisses()
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
    if (ids.length > 0) onDelete(ids)
  }
  function start () {
    if (closed) return Promise.resolve(false)
    if (loading) return loading
    const version = ++generation
    const current = () => !closed && generation === version
    const previous = subscription
    subscription = null
    previous?.return().catch(() => {})
    const previousDeletions = deletionSubscription
    deletionSubscription = null
    previousDeletions?.return().catch(() => {})
    onHistoryState('loading')
    const fail = error => {
      if (!current()) return
      generation++
      const failed = subscription
      subscription = null
      failed?.return().catch(() => {})
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
        // Settle read permissions first; initial subscription replay closes the
        // snapshot/live race. Recovery retains the messages and their outbox.
        const { results } = await eventStore.query(filter)
        if (!current()) return false
        const stream = eventStore.subscribe(filter, { initial: true })
        subscription = stream
        const live = (async () => {
          for await (const { result } of stream) {
            if (!current()) return
            await accept(result, filter, current)
          }
          if (current()) throw new Error('Self chat subscription ended')
        })()
        live.catch(fail)
        const deletionFilter = { kinds: [PERSONAL_COPY], authors: [pubkey], '#k': [String(DELETION_KIND)], '#c': [encodedContext], '#v': ['0', '1'] }
        const deletions = eventStore.subscribe(deletionFilter, { initial: true })
        deletionSubscription = deletions
        const deletionLive = (async () => {
          for await (const { result } of deletions) {
            if (!current()) return
            await acceptDeletion(result, deletionFilter, current)
          }
        })()
        deletionLive.catch(fail)
        for (const wrapper of results) {
          if (!current()) return false
          await accept(wrapper, filter, current)
        }
        if (!current()) return false
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
      }
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
    const createdAt = Math.floor(Date.now() / 1000)
    const reply = replyTo ? messages.get(replyTo) : null
    const tags = reply ? [['q', reply.id, '', pubkey]] : []
    let fileEvent = null
    if (attachment) {
      const { root, mime, size, width, height, thumbhash } = attachment.metadata
      const filename = encodedFileName(attachment.metadata)
      const url = `https://nostr.alt/${nfileEncode({ root, mime, filename })}?localOnly=1`
      attachment = { ...attachment, metadata: { root, mime, size, width, height, thumbhash, filename, url, service: 'irfs' } }
      fileEvent = createFileMetadata({ ...attachment.metadata, caption: content, created_at: createdAt })
      const fileId = getEventHash({ ...fileEvent, pubkey })
      tags.push(['q', fileId, '', pubkey])
    }
    // NIP-21 URIs come first: the replied message (kind 9), then the file
    // metadata (1063) when this message carries an attachment. A caption lives
    // only on the 1063, so the 9 has no extra text in that case.
    const uris = []
    if (reply) uris.push(chatReferenceUri(reply))
    if (fileEvent) uris.push(chatReferenceUri({ ...fileEvent, pubkey, id: getEventHash({ ...fileEvent, pubkey }) }))
    const text = attachment ? '' : content
    const event = {
      kind: SELF_CHAT_KIND,
      created_at: createdAt,
      content: [...uris, text].filter(Boolean).join('\n'),
      tags: [...tags, ['zillion', crypto.randomUUID()]]
    }
    const id = getEventHash({ ...event, pubkey })
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
    subscription?.return().catch(() => {})
    deletionSubscription?.return().catch(() => {})
  }

  // Deleting a message keeps the file metadata (1063) and everything else it
  // references: only the kind-9 message is removed, and the request travels as
  // a private deletion envelope so paired devices apply the same removal.
  function deleteMessage (id) {
    if (closed) throw new Error('Self chat is closed')
    const message = messages.get(id)
    if (!message || message.status !== 'saved') return Promise.resolve(false)
    messages.delete(id)
    emit()
    const request = {
      kind: DELETION_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['e', id], ['k', String(message.kind ?? SELF_CHAT_KIND)]],
      content: ''
    }
    return Promise.resolve(eventStore.addPersonalCopy(request, { context }))
      .then(result => result?.result?.ok !== false)
      .catch(error => { onError(error); return false })
      .then(saved => {
        if (saved) return true
        if (!closed && !messages.has(id)) { messages.set(id, message); emit() }
        return false
      })
  }
  return {
    start,
    send,
    deleteMessage,
    retry: write,
    close,
    // Pending/local events and store lookups share one resolver.
    resolveReference: reference => references.resolve(reference),
    readFiles: options => references.readFiles(options)
  }
}
