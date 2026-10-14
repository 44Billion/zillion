import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { createQueue } from 'libp2r2p/idb-queue'
import { getEventHash } from 'libp2r2p/event'
import { createConversationSummaryCache } from '#services/conversation-summary-cache.js'

const owner = 'a'.repeat(64)
const peer = 'b'.repeat(64)
const inner = { kind: 9, pubkey: peer, created_at: 100, tags: [], content: 'private preview text' }
const record = { peer, context: 'opaque-conversation', event: { ...inner, id: getEventHash(inner) }, copies: [{ id: 'c'.repeat(64), created_at: 100 }], references: {}, sources: {} }
async function signer () {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const calls = { encrypt: 0, decrypt: 0 }
  return {
    calls,
    nip44v3: {
      async encrypt (pk, kind, scope, plaintext) {
        assert.equal(pk, owner); assert.equal(kind, 9); assert.equal(scope, 'zillion:conversation-summaries:v1')
        calls.encrypt++
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
        return JSON.stringify({ iv: [...iv], bytes: [...new Uint8Array(bytes)] })
      },
      async decrypt (pk, kind, scope, ciphertext) {
        assert.equal(pk, owner); assert.equal(kind, 9); assert.equal(scope, 'zillion:conversation-summaries:v1')
        calls.decrypt++
        const value = JSON.parse(ciphertext)
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv) }, key, new Uint8Array(value.bytes))
      }
    }
  }
}

test('one encrypted snapshot survives reopening with full messages and opaque storage', async t => {
  const indexedDB = new IDBFactory()
  const cryptoSigner = await signer()
  const first = createConversationSummaryCache({ owner, signer: cryptoSigner, indexedDB })
  await first.write([record]); await first.close()
  const second = createConversationSummaryCache({ owner, signer: cryptoSigner, indexedDB })
  t.after(() => second.close())
  assert.deepEqual(await second.read(), [record])
  assert.equal(cryptoSigner.calls.decrypt, 1)
  const raw = await createQueue({ prefix: `zillion:conversation-summaries:v1:${owner}`, indexedDB, indexes: { id: { keyPath: 'id', unique: true } }, evictionPolicy: 'reject', maxBytes: 2 * 1024 * 1024 })
  t.after(() => raw.close())
  const rows = await Array.fromAsync(raw.storedItems())
  assert.deepEqual(Object.keys(rows[0]).sort(), ['ciphertext', 'id'])
  for (const privateValue of [peer, inner.content, record.context]) assert.equal(JSON.stringify(rows).includes(privateValue), false)
  const other = createConversationSummaryCache({ owner: 'd'.repeat(64), signer: cryptoSigner, indexedDB })
  t.after(() => other.close())
  assert.deepEqual(await other.read(), [])
})

test('invalid, oversized and excessive projections cannot become a restored chat', async t => {
  const indexedDB = new IDBFactory()
  const cryptoSigner = await signer()
  const cache = createConversationSummaryCache({ owner, signer: cryptoSigner, indexedDB })
  t.after(() => cache.close())
  const oversized = { ...inner, content: 'x'.repeat(1024 * 1024) }
  await cache.write([{ ...record, event: { ...oversized, id: getEventHash(oversized) } }, { ...record, event: { ...record.event, pubkey: 'd'.repeat(64) } }, record])
  assert.deepEqual(await cache.read(), [record])
  const many = Array.from({ length: 140 }, (_, index) => ({ ...record, peer: index.toString(16).padStart(64, '0'), event: { ...record.event, pubkey: owner } })).map(value => ({ ...value, event: { ...value.event, id: getEventHash(value.event) } }))
  await cache.write(many)
  assert.equal((await cache.read()).length, 128)
  await cache.write([])
  assert.deepEqual(await cache.read(), [])
})

test('closing during encryption cannot write a late snapshot', async () => {
  const indexedDB = new IDBFactory()
  const cryptoSigner = await signer()
  const gate = Promise.withResolvers()
  const entered = Promise.withResolvers()
  const encrypt = cryptoSigner.nip44v3.encrypt
  cryptoSigner.nip44v3.encrypt = async (...args) => { entered.resolve(); await gate.promise; return encrypt(...args) }
  const cache = createConversationSummaryCache({ owner, signer: cryptoSigner, indexedDB })
  const write = cache.write([record])
  await entered.promise
  await cache.close(); gate.resolve(); await write
  const reopened = createConversationSummaryCache({ owner, signer: cryptoSigner, indexedDB })
  assert.deepEqual(await reopened.read(), [])
  await reopened.close()
})

test('unrelated public-reference payloads do not evict an otherwise small latest-message projection', async t => {
  const indexedDB = new IDBFactory()
  const cache = createConversationSummaryCache({ owner, signer: await signer(), indexedDB })
  t.after(() => cache.close())
  const profile = { kind: 0, pubkey: peer, created_at: 100, tags: [], content: 'x'.repeat(1024 * 1024) }
  profile.id = getEventHash(profile)
  await cache.write([{ ...record, references: { [profile.id]: profile }, sources: { [profile.id]: { personal: false, ids: [profile.id] } } }])
  assert.deepEqual(await cache.read(), [record])
})
