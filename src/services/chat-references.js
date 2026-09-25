import { PERSONAL_COPY } from 'libp2r2p/kind'
import { neventEncode } from 'libp2r2p/nip19'
import { getEventHash, isSerializableEvent, isValidEvent } from 'libp2r2p/event'

// Inner kinds the self chat augments in place. Everything else stays a plain
// inline reference (compact label/link), exactly like before.
export const CHAT_TEXT_KIND = 9
export const CHAT_FILE_KIND = 1063

const HEX64_RE = /^[0-9a-f]{64}$/i

export function isChatInnerKind (kind) {
  return kind === CHAT_TEXT_KIND || kind === CHAT_FILE_KIND
}

// A reference is worth resolving when it may be a chat message (9) or its file
// metadata (1063). A missing kind (`note1`) must be looked up to find out.
export function isResolvableChatReference (reference) {
  return reference?.kind == null || isChatInnerKind(reference.kind)
}

// NIP-21 URI for an inner chat event: kind and author, no relay hints because
// personal copies are never published.
export function chatReferenceUri (event) {
  return `nostr:${neventEncode({ id: event.id, author: event.pubkey, kind: event.kind })}`
}

// Same admission rules the self-chat subscription applies to live wrappers:
// owner, context, provenance and a matching inner payload.
export async function decryptPersonalCopy (wrapper, { pubkey, signer, encodedContext, authors = [pubkey], hearsay = false }) {
  if (wrapper?.kind !== PERSONAL_COPY || wrapper.pubkey !== pubkey || !isValidEvent(wrapper)) return null
  const tags = name => wrapper.tags.filter(tag => tag[0] === name)
  const kindTags = tags('k')
  const contextTags = tags('c')
  const provenanceTags = tags('v')
  if (kindTags.length !== 1 || contextTags.length !== 1 || contextTags[0][1] !== encodedContext) return null
  if (provenanceTags.length !== 1 || !(hearsay ? ['0', '1', '2'] : ['0', '1']).includes(provenanceTags[0][1])) return null
  const innerKind = Number(kindTags[0][1])
  if (!Number.isInteger(innerKind) || innerKind < 0) return null
  const plaintext = await signer.nip44v3.decrypt(pubkey, innerKind, '', wrapper.content)
  // Signer/transport failures above remain retryable. Malformed plaintext is
  // an invalid item, so it must not permanently block a history page.
  let inner
  try { inner = JSON.parse(new TextDecoder().decode(plaintext)) } catch { return null }
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return null
  const event = { ...inner, pubkey: inner.pubkey ?? pubkey }
  if ((authors && !authors.includes(event.pubkey)) || String(event.kind) !== kindTags[0][1]) return null
  if (event.created_at !== wrapper.created_at || !isSerializableEvent(event)) return null
  if (provenanceTags[0][1] === '0' ? !isValidEvent(event) : ('id' in inner || 'sig' in inner || (provenanceTags[0][1] === '2' && !inner.pubkey))) return null
  return { ...event, id: getEventHash(event), ...(provenanceTags[0][1] === '2' ? { hearsay: true } : {}) }
}

// Lazy reference lookups for one account/context. Personal copies are found
// through their obfuscated source-id mirror; public events are read by id.
// Pending outbox events are consulted first so a message renders immediately.
export function createChatReferences ({
  pubkey,
  eventStore,
  signer,
  context = `dm:${pubkey}`,
  limit = 100,
  onResolved = () => {}
}) {
  const cache = new Map()
  const pending = new Map()
  // References that resolved to nothing. They are retried when new messages
  // arrive, because a personal copy may land after the one that references it.
  const misses = new Set()
  const locals = new Map()
  const removed = new Set()
  let encodedContextPromise
  const encodedContext = () => (encodedContextPromise ??= signer.obfuscate(context, String(PERSONAL_COPY), '').catch(error => {
    encodedContextPromise = undefined
    throw error
  }))

  async function readWrapper (wrapper) {
    return decryptPersonalCopy(wrapper, { pubkey, signer, encodedContext: await encodedContext(), authors: null, hearsay: true })
  }

  async function load (id) {
    const mirror = await signer.obfuscate(id, String(PERSONAL_COPY), '.id')
    const { results: copies = [] } = await eventStore.query({
      kinds: [PERSONAL_COPY], authors: [pubkey], '#o': [mirror], '#c': [await encodedContext()], '#v': ['0', '1', '2'], limit: 3
    })
    for (const wrapper of copies.toSorted((a, b) => Number(a.tags.find(tag => tag[0] === 'v')?.[1]) - Number(b.tags.find(tag => tag[0] === 'v')?.[1]))) {
      const event = await readWrapper(wrapper)
      if (event?.id === id) return event
    }
    const { results: publicEvents = [] } = await eventStore.query({ ids: [id], limit: 1 })
    return publicEvents.find(event => event?.id === id) ?? null
  }

  return {
    // Pending outbox events by inner id; messages read them before the store.
    locals,
    peek: id => locals.get(id) || cache.get(id),
    refresh (event) {
      if (event.hearsay || (!locals.has(event.id) && !cache.has(event.id))) return
      if (locals.has(event.id)) locals.set(event.id, event)
      cache.set(event.id, event)
      onResolved(event.id, event)
    },
    remove (ids) {
      for (const id of ids) {
        removed.add(id)
        locals.delete(id)
        cache.delete(id)
        misses.delete(id)
        onResolved(id, null)
      }
    },
    clear () {
      cache.clear()
      pending.clear()
      misses.clear()
      locals.clear()
      removed.clear()
      encodedContextPromise = undefined
    },
    // Invalidate misses and start their lookups again. Returns the number of
    // restarted lookups so callers can skip redundant work.
    retryMisses () {
      let restarted = 0
      for (const id of [...misses]) {
        misses.delete(id)
        cache.delete(id)
        if (this.resolve({ id })) restarted++
      }
      return restarted
    },
    // Returns the resolved inner event when cached, otherwise starts the lookup
    // (the caller re-renders through the references signal when it lands).
    resolve (reference) {
      const id = typeof reference === 'string' ? reference : reference?.id
      if (!HEX64_RE.test(id ?? '') || removed.has(id)) return null
      // Pending outbox events resolve immediately and must still notify the
      // caller, otherwise a bubble that rendered before confirmation has no
      // reason to re-render with the referenced quote or attachment.
      if (locals.has(id)) {
        const event = locals.get(id)
        if (!cache.has(id)) {
          cache.set(id, event)
          onResolved(id, event)
        }
        return event
      }
      if (cache.has(id)) return cache.get(id)
      if (!pending.has(id)) {
        pending.set(id, load(id)
          .then(event => {
            if (removed.has(id)) return null
            cache.set(id, event)
            if (event) onResolved(id, event)
            else misses.add(id)
            return event
          })
          .catch(error => {
            if (!/DENIED|PERMISSION|REVOKED|INVALID|NOT_IN_PERSONA/i.test(`${error?.code || ''} ${error?.message || ''}`)) misses.add(id)
            return null
          })
          .finally(() => pending.delete(id)))
      }
      return null
    },
    // UI layout can await the targeted lookup without changing the synchronous
    // cache-peek contract used by reference models.
    prepare (reference) {
      const value = this.resolve(reference)
      const id = typeof reference === 'string' ? reference : reference?.id
      return value ?? pending.get(id) ?? null
    },
    // Inner kind-1063 events of this context, newest first, for the composer
    // attachment catalog. Decryption is required before any mime filtering.
    async readFiles ({ limit: readLimit = limit, root } = {}) {
      // The wrapper carries the inner kind in its plaintext one-letter `k` tag,
      // which the store indexes, so the kind-1063 filter happens in the store.
      // Decryption still validates owner, context, provenance and inner kind.
      const { results: copies = [] } = await eventStore.query({
        kinds: [PERSONAL_COPY], authors: [pubkey], '#k': [String(CHAT_FILE_KIND)], '#c': [await encodedContext()], '#v': ['0', '1'],
        ...(root ? { '#o': [await signer.obfuscate(root, String(PERSONAL_COPY), '#r')] } : {}), limit: readLimit
      })
      const events = []
      for (const wrapper of copies.toSorted((a, b) => Number(a.tags.find(tag => tag[0] === 'v')?.[1]) - Number(b.tags.find(tag => tag[0] === 'v')?.[1]))) {
        const event = await readWrapper(wrapper).catch(error => {
          // Root lookups decide whether to create a catalog copy. A failed
          // decryption must not be mistaken for an absent entry.
          throw error
        })
        if (event?.kind === CHAT_FILE_KIND && (!root || event.tags.some(tag => tag[0] === 'r' && tag[1] === root))) events.push(event)
      }
      return events.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
    }
  }
}
