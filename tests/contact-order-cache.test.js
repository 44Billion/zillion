import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { createQueue } from 'libp2r2p/idb-queue'
import { createContactOrderCache } from '#services/contact-order-cache.js'

const owner = 'a'.repeat(64)
const peers = ['b', 'c', 'd'].map(value => value.repeat(64))

async function signer () {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const calls = { encrypt: 0, decrypt: 0 }
  return {
    calls,
    nip44v3: {
      async encrypt (pk, kind, scope, plaintext) {
        assert.equal(pk, owner); assert.equal(kind, 9); assert.equal(scope, 'zillion:contact-order:v1')
        calls.encrypt++
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
        return JSON.stringify({ iv: [...iv], bytes: [...new Uint8Array(bytes)] })
      },
      async decrypt (pk, kind, scope, ciphertext) {
        assert.equal(pk, owner); assert.equal(kind, 9); assert.equal(scope, 'zillion:contact-order:v1')
        calls.decrypt++
        const value = JSON.parse(ciphertext)
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv) }, key, new Uint8Array(value.bytes))
      }
    }
  }
}

test('one encrypted contact-order snapshot survives reopening without plaintext identities', async t => {
  const indexedDB = new IDBFactory()
  const cryptoSigner = await signer()
  const first = createContactOrderCache({ owner, signer: cryptoSigner, indexedDB })
  await first.write(['user', peers[0], peers[0], 'invalid', peers[1]])
  await first.close()

  const second = createContactOrderCache({ owner, signer: cryptoSigner, indexedDB })
  t.after(() => second.close())
  assert.deepEqual(await second.read(), ['user', peers[0], peers[1]])
  assert.equal(cryptoSigner.calls.decrypt, 1)

  const raw = await createQueue({
    prefix: `zillion:contact-order:v1:${owner}`,
    indexedDB,
    indexes: { id: { keyPath: 'id', unique: true } },
    evictionPolicy: 'reject',
    maxBytes: 128 * 1024
  })
  t.after(() => raw.close())
  const rows = await Array.fromAsync(raw.storedItems())
  assert.deepEqual(Object.keys(rows[0]).sort(), ['ciphertext', 'id'])
  assert.equal(JSON.stringify(rows).includes(peers[0]), false)

  const other = createContactOrderCache({ owner: 'e'.repeat(64), signer: cryptoSigner, indexedDB })
  t.after(() => other.close())
  assert.deepEqual(await other.read(), [])
})

test('contact-order snapshots are bounded and closing cannot admit a late encryption', async t => {
  const indexedDB = new IDBFactory()
  const cryptoSigner = await signer()
  const cache = createContactOrderCache({ owner, signer: cryptoSigner, indexedDB })
  t.after(() => cache.close())
  const many = Array.from({ length: 520 }, (_, index) => index.toString(16).padStart(64, '0'))
  await cache.write(many)
  assert.equal((await cache.read()).length, 512)

  const gate = Promise.withResolvers()
  const entered = Promise.withResolvers()
  const encrypt = cryptoSigner.nip44v3.encrypt
  cryptoSigner.nip44v3.encrypt = async (...args) => {
    entered.resolve()
    await gate.promise
    return encrypt(...args)
  }
  const write = cache.write([peers[0]])
  await entered.promise
  await cache.close()
  gate.resolve()
  await write

  const reopened = createContactOrderCache({ owner, signer: cryptoSigner, indexedDB })
  t.after(() => reopened.close())
  assert.equal((await reopened.read()).length, 512)
})
