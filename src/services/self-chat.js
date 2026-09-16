import { encodedFileName } from '#helpers/attachment-presentation.js'
import { nfileEncode } from 'libp2r2p/nip19'
import { decodeIrfsChunk } from 'libp2r2p/irfs'
import { getEventHash, isSerializableEvent, isValidEvent } from 'libp2r2p/event'
import { createFileMetadata } from 'libp2r2p/nip94'
import { verifyLocalFile } from './chat-attachments.js'
import { PERSONAL_COPY } from 'libp2r2p/kind'
import { compactWhitespace } from 'libp2r2p/nip27'

export const SELF_CHAT_KIND = 9

// The launcher owns encryption, signing and persistence. This service only
// interprets its personal-copy contract for the primary user's own chat.
export function createSelfChat ({ pubkey, eventStore, signer, onMessages, onError, onInitialLoad = () => {}, onHistoryState = () => {}, verifyFile = verifyLocalFile }) {
  const context = `dm:${pubkey}`
  const messages = new Map()
  const outbox = new Map()
  const controller = new AbortController()
  let closed = false
  let subscription
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
    if (!current() || wrapper?.kind !== PERSONAL_COPY || wrapper.pubkey !== pubkey || !isValidEvent(wrapper)) return
    const tag = name => wrapper.tags.filter(tag => tag[0] === name)
    if (tag('k').length !== 1 || !['9', '1063'].includes(tag('k')[0][1]) || tag('c').length !== 1 || tag('c')[0][1] !== filter['#c'][0]) return
    if (tag('v').length !== 1 || !['0', '1'].includes(tag('v')[0][1])) return
    const plaintext = await signer.nip44v3.decrypt(pubkey, Number(tag('k')[0][1]), '', wrapper.content)
    if (!current()) return
    const inner = JSON.parse(new TextDecoder().decode(plaintext))
    const event = { ...inner, pubkey: inner.pubkey ?? pubkey }
    if (event.pubkey !== pubkey || String(event.kind) !== tag('k')[0][1] || event.created_at !== wrapper.created_at || !isSerializableEvent(event)) return
    if (tag('v')[0][1] === '0' ? !isValidEvent(event) : ('id' in inner || 'sig' in inner || 'pubkey' in inner)) return
    const id = getEventHash(event)
    confirm(id, event)
  }
  function start () {
    if (closed) return Promise.resolve(false)
    if (loading) return loading
    const version = ++generation
    const current = () => !closed && generation === version
    const previous = subscription
    subscription = null
    previous?.return().catch(() => {})
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
        const filter = { kinds: [PERSONAL_COPY], authors: [pubkey], '#k': ['9', '1063'], '#c': [encodedContext], '#v': ['0', '1'] }
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
    const textEvent = {
      kind: SELF_CHAT_KIND, created_at: Math.floor(Date.now() / 1000), content,
      tags: [...(replyTo ? [['q', replyTo, '', pubkey]] : []), ['zillion', crypto.randomUUID()]]
    }
    if (attachment) {
      const { root, mime, size, width, height, thumbhash } = attachment.metadata
      const filename = encodedFileName(attachment.metadata)
      const url = `https://nostr.alt/${nfileEncode({ root, mime, filename })}?localOnly=1`
      attachment = { ...attachment, metadata: { root, mime, size, width, height, thumbhash, filename, url, service: 'irfs' } }
    }
    const event = attachment
      ? createFileMetadata({ ...attachment.metadata, caption: content, created_at: textEvent.created_at, tags: textEvent.tags })
      : textEvent
    const id = getEventHash({ ...event, pubkey })
    messages.set(id, { ...event, pubkey, id, status: 'pending', localSource: attachment?.source })
    outbox.set(id, { event, attachment, work: null })
    write(id)
    return id
  }
  function close () {
    closed = true
    generation++
    controller.abort()
    for (const entry of outbox.values()) entry.attachment?.close?.()
    outbox.clear()
    subscription?.return().catch(() => {})
  }
  return { start, send, retry: write, close }
}
