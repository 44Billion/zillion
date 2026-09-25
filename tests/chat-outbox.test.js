import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { createQueue } from 'libp2r2p/idb-queue'
import { getEventHash } from 'libp2r2p/event'
import { createChatOutbox } from '#services/chat-outbox.js'
import { createPrivateChats } from '#services/private-chats.js'

const owner = 'a'.repeat(64)
const peer = 'b'.repeat(64)
const event = { kind: 9, pubkey: owner, created_at: 100, tags: [['salt', 'stable']], content: 'secret checkpoint text' }
const entry = { id: getEventHash(event), peer, event, localSaved: [false], index: 0 }

async function createSigner () {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return {
    getPublicKey: async () => owner,
    withSharedKey: pk => ({ getPublicKey: async () => `channel:${pk}` }),
    nip44v3: {
      async encrypt (pk, kind, scope, bytes) {
        assert.equal(pk, owner); assert.equal(kind, 9); assert.equal(scope, 'zillion:outbox')
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
        return JSON.stringify({ iv: [...iv], ciphertext: [...new Uint8Array(ciphertext)] })
      },
      async decrypt (pk, kind, scope, text) {
        assert.equal(pk, owner); assert.equal(kind, 9); assert.equal(scope, 'zillion:outbox')
        const { iv, ciphertext } = JSON.parse(text)
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(ciphertext))
      }
    }
  }
}

test('outbox stores only opaque payloads, preserves ID order and isolates owners', async t => {
  const indexedDB = new IDBFactory()
  const signer = await createSigner()
  const first = await createChatOutbox({ owner, signer, indexedDB })
  const early = { ...entry, id: '0'.repeat(64) }
  await first.put(entry)
  await first.put(early)
  await first.close()
  const second = await createChatOutbox({ owner, signer, indexedDB })
  const other = await createChatOutbox({ owner: peer, signer, indexedDB })
  t.after(() => second.close()); t.after(() => other.close())
  assert.deepEqual(await second.list(), [early, entry])
  assert.deepEqual(await second.list(), [early, entry], 'listing never consumes records')
  assert.deepEqual(await other.list(), [])
  const raw = await createQueue({ prefix: `zillion:outbox:${owner}`, indexes: { byId: { keyPath: 'id', unique: true } }, evictionPolicy: 'reject', indexedDB })
  t.after(() => raw.close())
  const rows = await Array.fromAsync(raw.storedItems())
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['ciphertext', 'id'])
  assert.equal(JSON.stringify(rows).includes(event.content), false)
  assert.equal(JSON.stringify(rows).includes(peer), false)
  await raw.putBy('byId', { id: entry.id, ciphertext: await signer.nip44v3.encrypt(owner, 9, 'zillion:outbox', new TextEncoder().encode(JSON.stringify(early))) })
  await assert.rejects(second.list(), /INVALID_OUTBOX_ENTRY/)
})

test('a checkpoint encrypted before cancellation cannot recreate the removed entry', async t => {
  const indexedDB = new IDBFactory()
  const signer = await createSigner()
  const first = await createChatOutbox({ owner, signer, indexedDB })
  const second = await createChatOutbox({ owner, signer, indexedDB })
  t.after(() => first.close()); t.after(() => second.close())
  await first.put(entry)
  const started = Promise.withResolvers()
  const resume = Promise.withResolvers()
  const encrypt = signer.nip44v3.encrypt
  signer.nip44v3.encrypt = async (...args) => {
    const ciphertext = await encrypt(...args)
    started.resolve()
    await resume.promise
    return ciphertext
  }
  const checkpoint = first.put({ ...entry, localSaved: [true] }, { existing: true })
  await started.promise
  await second.remove(entry.id)
  resume.resolve()
  assert.equal(await checkpoint, false)
  assert.equal(await first.has(entry.id), false)
  assert.deepEqual(await second.list(), [])
})

test('coordinator reopens the real encrypted outbox and retries only unfinished stages', async t => {
  const indexedDB = new IDBFactory()
  const signer = await createSigner()
  const writes = []; const sends = []
  async function open (offline) {
    const failure = Promise.withResolvers()
    const finished = Promise.withResolvers()
    const messenger = {
      update: async () => {}, pause: async () => {}, resume: async () => {}, close: async () => {}, nextMessage: async () => null,
      async broadcastRumor (options) {
        sends.push(options.rumor)
        if (offline) throw new Error('offline')
        return { delivery: { reports: [{ success: true }] } }
      }
    }
    let hadEntry = false
    let storageClosed = false
    const transport = createPrivateChats({
      owner, signer, Messenger: async () => messenger,
      eventStore: { addPersonalCopy: async value => { writes.push(value); return { result: { ok: true } } } },
      openOutbox: async options => {
        const outbox = await createChatOutbox({ ...options, indexedDB })
        return { ...outbox, async close () { await outbox.close(); storageClosed = true } }
      },
      onError: error => failure.resolve(error),
      onOutbox: entries => { if (entries.length) hadEntry = true; else if (hadEntry) finished.resolve() }
    })
    t.after(() => transport.close())
    await transport.setPeers([peer])
    await transport.setState({ access: 'allowed', connection: 'connected', isLocked: false, isReadOnly: false })
    return { transport, failure: failure.promise, finished: finished.promise, isClosed: () => storageClosed }
  }
  const a = await open(true)
  const id = await a.transport.enqueue({ peer, event })
  assert.match((await a.failure).message, /offline/)
  await a.transport.close()
  assert.equal(a.isClosed(), true)
  const pending = await createChatOutbox({ owner, signer, indexedDB })
  assert.deepEqual((await pending.list())[0].localSaved, [true])
  await pending.close()
  const b = await open(false)
  await b.finished
  await b.transport.close()
  assert.equal(b.isClosed(), true)
  assert.equal(writes.length, 1)
  assert.equal(sends.length, 2)
  assert.deepEqual(sends[0], sends[1])
  assert.equal(getEventHash(sends[1]), id)
  const completed = await createChatOutbox({ owner, signer, indexedDB })
  t.after(() => completed.close())
  assert.deepEqual(await completed.list(), [])
})
