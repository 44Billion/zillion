import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasContentKeyMethods, isAccountAvailable } from '#helpers/account-availability.js'
import { dynamicContentKeySigner } from '#services/messenger-signer.js'
import { createMessengerSigner } from 'libp2r2p/private-messenger/session'

const available = { connection: 'connected', access: 'allowed', isDefaultUser: false, supportsContentKeyMethods: true, isReadOnly: false, isLocked: false }

test('account readiness rejects signed-out and incompatible accounts without confusing connectivity or lock', () => {
  assert.equal(isAccountAvailable(available), true)
  for (const patch of [{ isDefaultUser: true }, { supportsContentKeyMethods: false }, { isReadOnly: true }, { isLocked: true }, { isLocked: null }, { access: 'revoked' }, { connection: 'unknown' }]) {
    assert.equal(isAccountAvailable({ ...available, ...patch }), false)
  }
  assert.equal(isAccountAvailable(null), false)
  const complete = { doubleSignEvent () {}, nip44v3: { encryptDoubleDH () {}, decryptDoubleDH () {} } }
  assert.equal(hasContentKeyMethods(complete), true)
  assert.equal(hasContentKeyMethods({ ...complete, doubleSignEvent: undefined }), false)
  assert.equal(hasContentKeyMethods({ ...complete, nip44v3: { encryptDoubleDH () {} } }), false)
  assert.equal(hasContentKeyMethods(undefined), false)
})

test('session adapters survive same-identity capability recovery and withdrawal without exporting keys', async () => {
  const raw = { getPublicKey: () => 'a'.repeat(64), nip44v3: {} }
  raw.withSharedKey = () => raw
  const facade = dynamicContentKeySigner(raw)
  const adapter = createMessengerSigner(facade)
  assert.equal(hasContentKeyMethods(raw), false)
  assert.throws(() => adapter.nip44EncryptDoubleDH('peer', 9, '', 'AQID'), { code: 'UNSUPPORTED_METHOD' })
  const calls = []
  raw.doubleSignEvent = event => event
  raw.nip44v3.encryptDoubleDH = (...params) => { calls.push(params); return ['cipher', 'content-pubkey'] }
  raw.nip44v3.decryptDoubleDH = () => new Uint8Array([1, 2, 3]).buffer
  assert.equal(hasContentKeyMethods(raw), true)
  assert.deepEqual(await adapter.nip44EncryptDoubleDH('peer', 9, '', 'AQID'), ['cipher', 'content-pubkey'])
  assert.deepEqual(new Uint8Array(calls[0][3]), new Uint8Array([1, 2, 3]))
  assert.equal(await adapter.nip44DecryptDoubleDH('peer', 9, '', 'cipher'), 'AQID')
  const scoped = facade.withSharedKey('peer', 'dm')
  assert.deepEqual(await scoped.nip44v3.encryptDoubleDH('peer', 9, '', new ArrayBuffer(0)), ['cipher', 'content-pubkey'])
  delete raw.nip44v3.encryptDoubleDH
  assert.throws(() => adapter.nip44EncryptDoubleDH('peer', 9, '', 'AQID'), { code: 'UNSUPPORTED_METHOD' })
  assert.throws(() => scoped.nip44v3.encryptDoubleDH('peer', 9, '', new ArrayBuffer(0)), { code: 'UNSUPPORTED_METHOD' })
})
