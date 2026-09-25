import { run } from 'libp2r2p/idb'

// Only ciphertext and opaque event IDs are persisted here. Chunks are committed
// to the launcher's ordinary file store before an entry is accepted.
export async function createChatOutbox ({ owner, signer, indexedDB = globalThis.indexedDB }) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(`zillion:outbox:${owner}`, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'id' })
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  db.onversionchange = () => db.close()
  async function transaction (method, args, mode, existing = false) {
    const tx = db.transaction('entries', mode)
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('OUTBOX_ABORTED')); tx.onerror = () => reject(tx.error) })
    try {
      if (existing && (await run('getKey', [args[0].id], 'entries', null, { tx })).result === undefined) { await done; return false }
      const result = await run(method, args, 'entries', null, { tx }); await done; return result.result
    } catch (error) { await done.catch(() => {}); throw error }
  }
  return {
    async put (entry, { existing = false } = {}) {
      const bytes = new TextEncoder().encode(JSON.stringify(entry)).buffer
      const ciphertext = await signer.nip44v3.encrypt(owner, 9, 'zillion:outbox', bytes)
      await transaction('put', [{ id: entry.id, ciphertext }], 'readwrite', existing)
    },
    async list () {
      const rows = await transaction('getAll', [], 'readonly')
      const entries = []
      for (const row of rows) {
        const bytes = await signer.nip44v3.decrypt(owner, 9, 'zillion:outbox', row.ciphertext)
        const entry = JSON.parse(new TextDecoder().decode(bytes))
        if (entry.id !== row.id) throw new Error('INVALID_OUTBOX_ENTRY')
        entries.push(entry)
      }
      return entries
    },
    has: async id => (await transaction('getKey', [id], 'readonly')) !== undefined,
    remove: id => transaction('delete', [id], 'readwrite'),
    close: () => db.close()
  }
}
