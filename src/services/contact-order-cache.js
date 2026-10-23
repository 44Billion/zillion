import { createQueue } from 'libp2r2p/idb-queue'

const SCOPE = 'zillion:contact-order:v1'
const NIP44_KIND = 9
const MAX_BYTES = 64 * 1024
const MAX_IDS = 512
const hex = value => /^[0-9a-f]{64}$/.test(value || '')

function normalize (value, owner) {
  if (value?.owner !== owner || !Array.isArray(value.ids)) return []
  const ids = []
  const seen = new Set()
  for (const id of value.ids) {
    if (id !== 'user' && !hex(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length === MAX_IDS) break
  }
  return ids
}

// This disposable projection contains only the last stable visual order.
// Names, pins and profile metadata remain in their authoritative stores.
export function createContactOrderCache ({ owner, signer, indexedDB = globalThis.indexedDB }) {
  let database
  let closed = false
  const queue = () => (database ??= createQueue({
    prefix: `${SCOPE}:${owner}`,
    indexedDB,
    maxBytes: MAX_BYTES * 2,
    evictionPolicy: 'reject',
    indexes: { id: { keyPath: 'id', unique: true } }
  }).catch(error => { database = null; throw error }))

  return {
    async read () {
      if (closed) return []
      const row = await (await queue()).getBy('id', 'snapshot')
      if (!row || closed) return []
      const plaintext = await signer.nip44v3.decrypt(owner, NIP44_KIND, SCOPE, row.ciphertext)
      if (closed || plaintext.byteLength > MAX_BYTES) return []
      const value = JSON.parse(new TextDecoder().decode(plaintext))
      return normalize(value, owner)
    },
    async write (ids) {
      if (closed) return
      const normalized = normalize({ owner, ids }, owner)
      const plaintext = new TextEncoder().encode(JSON.stringify({ owner, ids: normalized })).buffer
      if (plaintext.byteLength > MAX_BYTES) throw new Error('CONTACT_ORDER_CACHE_TOO_LARGE')
      const ciphertext = await signer.nip44v3.encrypt(owner, NIP44_KIND, SCOPE, plaintext)
      if (!closed) await (await queue()).putBy('id', { id: 'snapshot', ciphertext })
    },
    async clear () { if (!closed) await (await queue()).removeBy('id', 'snapshot') },
    async close () { closed = true; if (database) await (await database).close() }
  }
}
