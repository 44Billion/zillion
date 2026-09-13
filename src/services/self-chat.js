import { getEventHash, isSerializableEvent, isValidEvent } from 'libp2r2p/event'
import { PERSONAL_COPY } from 'libp2r2p/kind'

export const SELF_CHAT_KIND = 9

// The launcher owns encryption, signing and persistence. This service only
// interprets its personal-copy contract for the primary user's own chat.
export function createSelfChat ({ pubkey, eventStore, signer, onMessages, onError, onInitialLoad = () => {} }) {
  const context = `dm:${pubkey}`
  const messages = new Map()
  let closed = false
  let subscription
  let pending
  let filter
  const emit = () => {
    if (!closed) onMessages([...messages.values()].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)))
  }
  async function accept (wrapper) {
    if (closed || wrapper?.kind !== PERSONAL_COPY || wrapper.pubkey !== pubkey || !isValidEvent(wrapper)) return
    const tag = name => wrapper.tags.filter(tag => tag[0] === name)
    if (tag('k').length !== 1 || tag('k')[0][1] !== '9' || tag('c').length !== 1 || tag('c')[0][1] !== filter['#c'][0]) return
    if (tag('v').length !== 1 || !['0', '1'].includes(tag('v')[0][1])) return
    const plaintext = await signer.nip44v3.decrypt(pubkey, 9, '', wrapper.content)
    const inner = JSON.parse(new TextDecoder().decode(plaintext))
    const event = { ...inner, pubkey: inner.pubkey ?? pubkey }
    if (event.pubkey !== pubkey || event.kind !== 9 || event.created_at !== wrapper.created_at || !isSerializableEvent(event)) return
    if (tag('v')[0][1] === '0' ? !isValidEvent(event) : ('id' in inner || 'sig' in inner || 'pubkey' in inner)) return
    const id = getEventHash(event)
    if (closed || messages.has(id)) return
    messages.set(id, { ...event, id })
    emit()
  }
  async function start () {
    try {
      const encodedContext = await signer.obfuscate(context, String(PERSONAL_COPY), '')
      if (closed) return
      filter = { kinds: [PERSONAL_COPY], authors: [pubkey], '#k': ['9'], '#c': [encodedContext], '#v': ['0', '1'] }
      subscription = eventStore.subscribe(filter, { initial: true })
      // Initial replay closes the snapshot/live race even across permission
      // dialogs. The query provides a prompt local read and explicit failures.
      const live = (async () => {
        for await (const { result } of subscription) await accept(result)
        if (!closed) throw new Error('Self chat subscription ended')
      })()
      live.catch(error => { if (!closed) onError(error) })
      const { results } = await eventStore.query(filter)
      for (const wrapper of results) await accept(wrapper)
      if (!closed) onInitialLoad()
    } catch (error) { if (!closed) onError(error) }
  }
  async function send (content, replyTo) {
    if (closed) throw new Error('Self chat is closed')
    if (typeof content !== 'string' || !content.trim()) return
    if (replyTo && !messages.has(replyTo)) throw new Error('Unknown reply target')
    const key = JSON.stringify([content, replyTo ?? null])
    if (pending?.key !== key) {
      pending = {
        key,
        event: {
          kind: SELF_CHAT_KIND, created_at: Math.floor(Date.now() / 1000), content,
          tags: [...(replyTo ? [['q', replyTo, '', pubkey]] : []), ['zillion', crypto.randomUUID()]]
        }
      }
    }
    const { event } = pending
    const saved = await eventStore.addPersonalCopy(event, { context })
    if (!saved?.result?.ok) throw new Error(`Message storage failed: ${saved?.result?.code ?? 'unknown'}`)
    const id = getEventHash({ ...event, pubkey })
    if (!closed) { messages.set(id, { ...event, pubkey, id }); emit() }
    if (pending?.event === event) pending = null
  }
  function close () {
    closed = true
    subscription?.return().catch(() => {})
  }
  return { start, send, close }
}
