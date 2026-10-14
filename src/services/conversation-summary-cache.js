import { createQueue } from 'libp2r2p/idb-queue'
import { getEventHash, isSerializableEvent } from 'libp2r2p/event'

const SCOPE = 'zillion:conversation-summaries:v1'
const MAX_BYTES = 1024 * 1024
const MAX_ENTRIES = 128
const hex = value => /^[0-9a-f]{64}$/.test(value || '')
const validEvent = event => event && hex(event.pubkey) && isSerializableEvent(event) && event.created_at <= 0xffffffff && event.id === getEventHash(event)

// This encrypted projection is disposable. Source copies remain in eventStore;
// no contact identity, timestamp, message or reference is stored in plaintext.
export function createConversationSummaryCache ({ owner, signer, indexedDB = globalThis.indexedDB }) {
  let database
  let closed = false
  const queue = () => (database ??= createQueue({
    prefix: `${SCOPE}:${owner}`, indexedDB, maxBytes: 2 * MAX_BYTES,
    evictionPolicy: 'reject', indexes: { id: { keyPath: 'id', unique: true } }
  }).catch(error => { database = null; throw error }))
  function normalize (record) {
    if (!hex(record?.peer) || typeof record.context !== 'string' || !record.context || record.context.length > 1024) return null
    const event = record.event
    if (!validEvent(event) || event.kind !== 9 || event.hearsay || ![owner, record.peer].includes(event.pubkey)) return null
    const copies = record.copies?.filter(copy => hex(copy.id) && copy.created_at === event.created_at).slice(0, 32)
    if (!copies?.length) return null
    const references = {}
    const sources = {}
    for (const [id, reference] of Object.entries(record.references || {}).slice(0, 32)) {
      const source = record.sources?.[id]
      if (![9, 1063].includes(reference?.kind) || id !== reference.id || !validEvent(reference) || !source?.ids?.length || !source.ids.every(hex)) continue
      references[id] = reference
      sources[id] = { personal: source.personal === true, ids: source.ids.slice(0, 32) }
    }
    return { peer: record.peer, context: record.context, event, copies, references, sources }
  }
  return {
    async read () {
      if (closed) return []
      const row = await (await queue()).getBy('id', 'snapshot')
      if (!row || closed) return []
      const plaintext = await signer.nip44v3.decrypt(owner, 9, SCOPE, row.ciphertext)
      if (closed || plaintext.byteLength > MAX_BYTES) return []
      const value = JSON.parse(new TextDecoder().decode(plaintext))
      if (value.version !== 1 || value.owner !== owner || !Array.isArray(value.records)) return []
      return value.records.slice(0, MAX_ENTRIES).map(normalize).filter(Boolean)
    },
    async write (records) {
      if (closed) return
      const selected = []
      let bytes = 0
      for (const record of records.toSorted((a, b) => (b.event?.created_at ?? 0) - (a.event?.created_at ?? 0))) {
        const value = normalize(record)
        if (!value) continue
        const size = new TextEncoder().encode(JSON.stringify(value)).length
        if (bytes + size > MAX_BYTES - 1024) continue
        selected.push(value); bytes += size
        if (selected.length === MAX_ENTRIES) break
      }
      const plaintext = new TextEncoder().encode(JSON.stringify({ version: 1, owner, records: selected })).buffer
      const ciphertext = await signer.nip44v3.encrypt(owner, 9, SCOPE, plaintext)
      if (!closed) await (await queue()).putBy('id', { id: 'snapshot', ciphertext })
    },
    async clear () { if (!closed) await (await queue()).removeBy('id', 'snapshot') },
    async close () { closed = true; if (database) await (await database).close() }
  }
}
