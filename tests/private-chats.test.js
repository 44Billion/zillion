import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { getEventHash } from 'libp2r2p/event'
import { createPrivateChats } from '#services/private-chats.js'
import { createChatOutbox } from '#services/chat-outbox.js'
import { contactMembership } from '#services/contacts.js'

const owner = 'a'.repeat(64)
const peer = 'b'.repeat(64)
const other = 'c'.repeat(64)
const active = { access: 'allowed', connection: 'connected', isLocked: false, isReadOnly: false }
const event = { kind: 9, created_at: 100, tags: [['salt', 'stable']], content: 'hello', pubkey: owner }
const until = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)) }; assert.fail('condition not reached') }

function fixture ({ primary = owner, records = new Map(), save = async () => ({ result: { ok: true } }), query = async () => ({ results: [] }), publish = async () => ({ delivery: { reports: [{ success: true }] } }) } = {}) {
  const states = []; const sends = []; const writes = []; const queue = []; const updates = []; const pauses = new Set()
  const signer = { getPublicKey: async () => primary, withSharedKey: (pubkey, info) => { assert.equal(info, 'dm'); return { getPublicKey: async () => `channel:${pubkey}` } } }
  const messenger = {
    update: async options => updates.push(options), pause: async reason => pauses.add(reason), resume: async reason => pauses.delete(reason), close: async () => {},
    async nextMessage () {
      const next = queue.find(value => !value.reserved)
      if (!next) return null
      next.reserved = true
      return { message: next.message, ack: async () => { next.acked = true; queue.splice(queue.indexOf(next), 1) }, nack: async () => { next.reserved = false } }
    },
    broadcastRumor: async options => { sends.push(structuredClone(options)); return publish(options) }
  }
  let callbacks
  const transport = createPrivateChats({
    owner: primary, signer, eventStore: { query, addPersonalCopy: async (...args) => { writes.push(args); return save(...args) } },
    Messenger: async options => { callbacks = options; return messenger },
    openOutbox: async () => ({ list: async () => [...records.values()].map(value => structuredClone(value)), put: async entry => { records.set(entry.id, structuredClone(entry)) }, remove: async id => records.delete(id), close () {} }),
    onOutbox: list => states.push(structuredClone(list)), onError () {}
  })
  return { transport, states, sends, writes, queue, updates, pauses, records, async open () { await transport.setPeers([peer]); await transport.setState(active) }, receive (message) { const row = { message }; queue.push(row); callbacks.onMessageQueued(); return row } }
}

test('both peer-chat participants seed recovery, retain NIP-65 routing and exclude self channels', async t => {
  for (const [primary, contact] of [[owner, peer], [peer, owner]]) {
    const f = fixture({ primary })
    t.after(() => f.transport.close())
    await f.transport.setPeers([primary, contact])
    await f.transport.setState(active)
    const settings = () => f.updates.at(-1).channels.map(({ signer: _signer, ...settings }) => settings)
    const expected = [{ pubkey: `channel:${contact}`, mode: 'seeder', seeders: [contact] }]
    assert.deepEqual(settings(), expected, 'only the contact is a remote seeder and relay routing is inherited')
    await f.transport.setState({ ...active, isLocked: true })
    await f.transport.setState(active)
    assert.deepEqual(settings(), expected)
    await f.transport.setPeers([primary])
    assert.deepEqual(settings(), [], 'removing the contact also stops its seeder channel')
    await f.transport.setPeers([contact])
    assert.deepEqual(settings(), expected, 'readding a retained channel preserves its seeder role')
  }
})

test('contacts merge owner lists and explicit overrides without confusing CRDT metadata', () => {
  const list = tags => ({ pubkey: owner, tags })
  assert.deepEqual(contactMembership([list([['p', peer], ['p', other]]), list([['p', 'd'.repeat(64)]]), list([['p', peer, '', '', '0', '~u=1;o=x'], ['p', other, '', '', '~u=2;o=x']])], owner).map(value => value.pubkey), [other, 'd'.repeat(64)])
  assert.deepEqual(contactMembership([{ pubkey: peer, tags: [['p', other]] }, null, null], owner), [])
})

test('durable retries reuse identity and skip a committed local write after reload', async () => {
  const records = new Map()
  const a = fixture({ records, publish: async () => { throw new Error('offline') } })
  await a.open()
  const id = await a.transport.enqueue({ peer, event })
  await until(() => a.states.at(-1)?.[0]?.status === 'error')
  assert.equal(a.writes.length, 1)
  assert.equal(a.writes[0][1].context, `dm:${peer}`)
  await a.transport.close()
  const b = fixture({ records })
  await b.open()
  await until(() => records.size === 0)
  assert.equal(b.writes.length, 0)
  assert.equal(getEventHash(b.sends[0].rumor), id)
  assert.deepEqual(b.sends[0].receiverPubkeys, [peer])
  assert.equal(b.sends[0].channelPubkey, `channel:${peer}`)
  await b.transport.close()
})

test('inbox persists hearsay attributed to owner before ack and retains failed saves', async () => {
  let fail = true
  const f = fixture({ save: async () => { if (fail) throw new Error('locked'); return { result: { ok: true } } } })
  await f.open()
  const inner = { ...event, id: getEventHash(event) }
  const row = f.receive({ channelPubkey: `channel:${peer}`, senderPubkey: peer, provenance: 'hearsay', event: inner })
  await until(() => f.pauses.has('storage'))
  assert.equal(row.acked, undefined)
  assert.equal(row.reserved, false)
  fail = false
  await f.transport.setState(active)
  await until(() => row.acked)
  assert.deepEqual(f.writes.at(-1)[1], { context: `dm:${peer}`, hearsay: true })
  const forbidden = f.receive({ channelPubkey: `channel:${peer}`, senderPubkey: other, provenance: 'direct', event: inner })
  await until(() => forbidden.acked)
  assert.equal(f.writes.length, 2)
  await f.transport.close()
})

test('removed contacts keep queued deliveries until readded, without blocking other work', async () => {
  const f = fixture()
  await f.open()
  await f.transport.setPeers([])
  const inner = { ...event, pubkey: peer }; inner.id = getEventHash(inner)
  const row = f.receive({ channelPubkey: `channel:${peer}`, senderPubkey: peer, provenance: 'direct', event: inner })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(row.acked, undefined)
  assert.equal(f.writes.length, 0)
  await f.transport.setPeers([peer])
  await until(() => row.acked)
  await f.transport.close()
})

test('outbox stores ciphertext and recovers records under the same owner', async () => {
  const indexedDB = new IDBFactory()
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const signer = {
    nip44v3: {
      async encrypt (pk, kind, scope, bytes) { assert.equal(pk, owner); assert.equal(scope, 'zillion:outbox'); const iv = crypto.getRandomValues(new Uint8Array(12)); const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes); return JSON.stringify({ iv: [...iv], sealed: [...new Uint8Array(sealed)] }) },
      async decrypt (_, kind, scope, text) { const { iv, sealed } = JSON.parse(text); return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(sealed)) }
    }
  }
  const first = await createChatOutbox({ owner, signer, indexedDB })
  const entry = { id: getEventHash(event), peer, event }
  await first.put(entry); await first.close()
  const second = await createChatOutbox({ owner, signer, indexedDB })
  assert.deepEqual(await second.list(), [entry])
  assert.equal(await second.has(entry.id), true)
  await second.remove(entry.id)
  await second.put(entry, { existing: true })
  assert.equal(await second.has(entry.id), false, 'late checkpoints never resurrect a cancelled record')
  assert.deepEqual(await second.list(), [])
  await second.close()
})

test('self chat uses the durable outbox without publishing to its own channel', async () => {
  const f = fixture()
  await f.open()
  const id = await f.transport.enqueue({ peer: owner, event })
  await until(() => f.records.size === 0)
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0][1].context, `dm:${owner}`)
  assert.equal(getEventHash(f.writes[0][0]), id)
  assert.equal(f.sends.length, 0)
  await f.transport.close()
})

test('cancellation during a context publication prevents publishing its queued main message', async () => {
  const held = Promise.withResolvers()
  const f = fixture({ publish: () => held.promise })
  await f.open()
  const quote = { ...event, pubkey: peer, content: 'quoted' }
  const id = await f.transport.enqueue({ peer, event, context: [quote] })
  await until(() => f.sends.length === 1)
  await f.transport.cancel(id)
  held.resolve({ delivery: { reports: [{ success: true }] } })
  await f.transport.close()
  assert.equal(f.sends.length, 1)
  assert.equal(f.sends[0].rumor.content, 'quoted')
  assert.equal(f.records.size, 0)
})

test('a persisted deletion blocks replay without stalling the remaining inbox', async () => {
  const f = fixture({ save: async event => ({ result: event.content === 'deleted' ? { ok: false, code: 'blocked' } : { ok: true } }) })
  await f.open()
  const receive = content => {
    const inner = { ...event, pubkey: peer, content }; inner.id = getEventHash(inner)
    return f.receive({ channelPubkey: `channel:${peer}`, senderPubkey: peer, provenance: 'direct', event: inner })
  }
  const deleted = receive('deleted'); const next = receive('next')
  await until(() => deleted.acked && next.acked)
  assert.equal(f.pauses.has('storage'), false)
  await f.transport.close()
})

test('hearsay control events cannot delete and a tombstoned outgoing message is never published', async () => {
  const f = fixture({ save: async () => ({ result: { ok: false, code: 'blocked' } }) })
  await f.open()
  const control = { ...event, kind: 5, tags: [['e', getEventHash(event)]] }; control.id = getEventHash(control)
  const row = f.receive({ channelPubkey: `channel:${peer}`, senderPubkey: peer, provenance: 'hearsay', event: control })
  await until(() => row.acked)
  assert.equal(f.writes.length, 0)
  await f.transport.enqueue({ peer, event })
  await until(() => f.records.size === 0)
  assert.equal(f.sends.length, 0)
  await f.transport.close()
})

test('attachment transport failure keeps the committed personal copy and retry checkpoint', async () => {
  const f = fixture({
    query: async () => {
      assert.equal(f.writes.length, 1, 'personal message commits before remote attachment work')
      throw new Error('attachment unavailable offline')
    }
  })
  await f.open()
  const metadata = { kind: 1063, pubkey: owner, created_at: 100, content: '', tags: [['url', 'https://example.test/file.png'], ['m', 'image/png'], ['r', 'd'.repeat(64)], ['size', '1'], ['service', 'irfs']] }
  const id = await f.transport.enqueue({ peer, event, context: [metadata], requiredFiles: [getEventHash(metadata)] })
  await until(() => f.states.at(-1)?.[0]?.status === 'error')
  assert.deepEqual(f.records.get(id).localSaved, [true, true])
  assert.equal(f.sends.length, 0)
  await f.transport.close()
})
