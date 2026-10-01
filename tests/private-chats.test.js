import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { getEventHash } from 'libp2r2p/event'
import { prepareIrfsFile } from 'libp2r2p/irfs'
import { createPrivateChats } from '#services/private-chats.js'
import { createChatOutbox } from '#services/chat-outbox.js'
import { ensurePrivateMedia } from '#services/private-media.js'
import { contactMembership } from '#services/contacts.js'

const owner = 'a'.repeat(64)
const peer = 'b'.repeat(64)
const other = 'c'.repeat(64)
const active = { access: 'allowed', connection: 'connected', isLocked: false, isReadOnly: false }
const event = { kind: 9, created_at: 100, tags: [['salt', 'stable']], content: 'hello', pubkey: owner }
const until = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)) }; assert.fail('condition not reached') }

function fixture ({ beforeOpen = async () => {}, fileAuthorize = async () => {}, fileDownload = async () => {}, downloadPut = async () => {}, downloadRemove = async () => {}, primary = owner, records = new Map(), save = async () => ({ result: { ok: true } }), query = async () => ({ results: [] }), publish = async () => ({ delivery: { reports: [{ success: true }] } }) } = {}) {
  const grants = []; const errors = []; const sendErrors = []; const states = []; const sends = []; const writes = []; const queue = []; const updates = []; const pauses = new Set()
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
    recoveryStorage: null,
    FileTransfer: () => ({
      observe () {},
      authorizeSeeding: async (file, options) => { grants.push({ file, ...options }); await fileAuthorize(file, options) },
      publishChunk: async (file, event) => { const options = { channelPubkey: `media:${file.root}`, rumor: event }; sends.push(options); return publish(options) },
      download: fileDownload, cancel () {}
    }),
    openDownloads: async () => ({ list: async () => [], put: downloadPut, remove: downloadRemove, close: async () => {} }),
    owner: primary, signer, eventStore: { query, addPersonalCopy: async (...args) => { writes.push(args); return save(...args) } },
    Messenger: async options => { callbacks = options; return messenger },
    openOutbox: async () => { await beforeOpen(); return { list: async () => [...records.values()].map(value => structuredClone(value)), put: async entry => { records.set(entry.id, structuredClone(entry)) }, remove: async id => records.delete(id), close () {} } },
    onOutbox: list => states.push(structuredClone(list)), onError: error => errors.push(error), onSendError: (error, attempt) => sendErrors.push({ error, attempt })
  })
  return { transport, grants, errors, sendErrors, states, sends, writes, queue, updates, pauses, records, async open () { await transport.setPeers([peer]); await transport.setState(active) }, receive (message) { const row = { message }; queue.push(row); callbacks.onMessageQueued(); return row } }
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

test('relay failures retain diagnostics and remain retryable without resaving the message', async t => {
  const timeout = Object.assign(new Error('PUBLISH_TIMEOUT', { cause: new Error('socket closed') }), { category: 'timeout' })
  const rejection = new Error('invalid: temporary relay policy')
  let fail = true
  const f = fixture({
    publish: async () => fail
      ? { delivery: { reports: [{ success: false, total: 2, promise: Promise.resolve({ total: 2, fulfilled: 0, errors: [{ relay: 'wss://one.test', reason: timeout }, { relay: 'wss://two.test', reason: rejection }] }) }] } }
      : { delivery: { reports: [{ success: true }] } }
  })
  t.after(() => f.transport.close())
  await f.open()
  const id = await f.transport.enqueue({ peer, event })
  await until(() => f.states.at(-1)?.[0]?.status === 'error')
  const error = f.errors.at(-1)
  assert.equal(error.code, 'MESSAGE_NOT_PUBLISHED')
  assert.equal(error.eventId, id)
  assert.equal(error.eventKind, 9)
  assert.match(error.message, /wss:\/\/one.test \[timeout\]: PUBLISH_TIMEOUT/)
  assert.match(error.message, /wss:\/\/two.test: invalid: temporary relay policy/)
  assert.equal(error.reports[0].errors[0].reason.cause.message, 'socket closed')
  assert.equal(f.records.get(id).retryable, true, 'relay text is not a signer permission denial')
  assert.equal(f.sendErrors[0].error, error)
  assert.deepEqual(f.sendErrors[0].attempt, { id, peer })
  await f.transport.retry(id)
  assert.equal(f.errors.length, 2)
  fail = false
  await f.transport.retry(id)
  assert.equal(f.records.size, 0)
  assert.equal(f.writes.length, 1)
  assert.ok(f.sends.every(send => getEventHash(send.rumor) === id))
})

test('original and thumbnail chunks publish on their own channels before the announcement', async () => {
  const { prepareIrfsFile } = await import('libp2r2p/irfs')
  const { createFileMetadata } = await import('libp2r2p/nip94')
  const { nfileEncode } = await import('libp2r2p/nip19')
  const original = await prepareIrfsFile(new Uint8Array(51001).fill(12))
  const thumbnail = await prepareIrfsFile(new Uint8Array(200).fill(13))
  const chunks = new Map()
  for (const file of [original, thumbnail]) for await (const event of file.chunks()) chunks.set(event.tags[0][1], event)
  const f = fixture({ query: async filter => ({ results: filter['#d'].map(id => chunks.get(id)).filter(Boolean) }) })
  try {
    await f.open()
    const metadata = { ...createFileMetadata({ url: `https://nostr.alt/${nfileEncode({ root: original.root, mime: 'image/png' })}?localOnly=1`, root: original.root, size: original.size, mime: 'image/png', service: 'irfs', thumbnail: { root: thumbnail.root, size: thumbnail.size, url: `https://nostr.alt/${nfileEncode({ root: thumbnail.root, mime: 'image/png' })}?localOnly=1` } }), pubkey: owner }
    await f.transport.enqueue({ peer, event, context: [metadata], requiredFiles: [getEventHash(metadata)] })
    await until(() => f.records.size === 0)
    assert.deepEqual(f.sends.map(send => send.rumor.kind), [34601, 34601, 34601, 1063, 9])
    assert.deepEqual(f.sends.map(send => send.channelPubkey), [`media:${original.root}`, `media:${original.root}`, `media:${thumbnail.root}`, `channel:${peer}`, `channel:${peer}`])
    assert.deepEqual(f.grants.map(grant => [grant.file.root, grant.receiverPubkeys, grant.sharedAt]), [[original.root, [peer], event.created_at], [thumbnail.root, [peer], event.created_at]])
    assert.ok(f.states.some(entries => entries.some(entry => entry.uploadProgress?.completed > 0)))
  } finally { await f.transport.close(); original.close(); thumbnail.close() }
})

test('cancel during encrypted download-intent write cannot resurrect the transfer', async () => {
  const started = Promise.withResolvers(); const release = Promise.withResolvers()
  let invoked = false; let removed = false
  const f = fixture({ fileDownload: async () => { invoked = true }, downloadPut: async () => { started.resolve(); await release.promise }, downloadRemove: async () => { removed = true } })
  try {
    await f.open()
    const file = { peer, root: 'e'.repeat(64), size: 2000000 }
    const downloading = f.transport.download(file, { manual: true })
    const rejected = assert.rejects(downloading, /cancelled/)
    await started.promise
    const cancelled = f.transport.cancelDownload(file)
    release.resolve()
    await Promise.all([cancelled, rejected])
    assert.equal(invoked, false)
    assert.equal(removed, true)
  } finally { await f.transport.close() }
})

test('new text is published between attachment chunks', async () => {
  const { prepareIrfsFile } = await import('libp2r2p/irfs')
  const { createFileMetadata } = await import('libp2r2p/nip94')
  const { nfileEncode } = await import('libp2r2p/nip19')
  const prepared = await prepareIrfsFile(new Uint8Array(51001).fill(19))
  const chunks = new Map()
  for await (const chunk of prepared.chunks()) chunks.set(chunk.tags[0][1], chunk)
  const first = Promise.withResolvers()
  const release = Promise.withResolvers()
  let held = false
  const f = fixture({
    query: async filter => ({ results: filter['#d'].map(id => chunks.get(id)).filter(Boolean) }), publish: async options => {
      if (options.rumor.kind === 34601 && !held) { held = true; first.resolve(); await release.promise }
      return { delivery: { reports: [{ success: true }] } }
    }
  })
  try {
    await f.open()
    const metadata = { ...createFileMetadata({ url: `https://nostr.alt/${nfileEncode({ root: prepared.root, mime: 'application/octet-stream' })}?localOnly=1`, root: prepared.root, size: prepared.size, mime: 'application/octet-stream', service: 'irfs' }), pubkey: owner }
    await f.transport.enqueue({ peer, event, context: [metadata] })
    await first.promise
    await f.transport.enqueue({ peer, event: { ...event, content: 'Urgent text' } })
    release.resolve()
    await until(() => f.records.size === 0)
    assert.equal(f.sends[0].rumor.kind, 34601)
    assert.equal(f.sends[1].rumor.content, 'Urgent text')
    assert.equal(f.sends[2].rumor.kind, 34601)
  } finally { await f.transport.close(); prepared.close() }
})

test('authorization failure blocks publication and retry preserves sharing time; a new send renews it', async () => {
  const { prepareIrfsFile } = await import('libp2r2p/irfs')
  const { createFileMetadata } = await import('libp2r2p/nip94')
  const { nfileEncode } = await import('libp2r2p/nip19')
  const prepared = await prepareIrfsFile(new Uint8Array(20).fill(5))
  const [chunk] = await Array.fromAsync(prepared.chunks())
  let failed = false
  const f = fixture({ query: async () => ({ results: [chunk] }), fileAuthorize: async () => { if (!failed) { failed = true; throw new Error('catalog quota') } } })
  try {
    await f.open()
    const metadata = { ...createFileMetadata({ url: `https://nostr.alt/${nfileEncode({ root: prepared.root, mime: 'application/octet-stream' })}?localOnly=1`, root: prepared.root, size: prepared.size, mime: 'application/octet-stream', service: 'irfs' }), pubkey: owner }
    const id = await f.transport.enqueue({ peer, event, context: [metadata] })
    await until(() => f.records.get(id)?.status === 'error')
    assert.equal(f.sends.length, 0)
    await f.transport.retry(id)
    await until(() => f.records.size === 0)
    await f.transport.enqueue({ peer, event: { ...event, created_at: 200 }, context: [metadata] })
    await until(() => f.records.size === 0)
    assert.deepEqual(f.grants.map(grant => grant.sharedAt), [100, 100, 200])
    assert.ok(f.grants.every(grant => grant.file.root === prepared.root))
  } finally { await f.transport.close(); prepared.close() }
})

test('media opened with local history waits for both contact discovery and transport recovery', async t => {
  const held = Promise.withResolvers()
  let downloads = 0
  const f = fixture({ beforeOpen: () => held.promise, fileDownload: async file => { downloads++; return file } })
  t.after(() => { held.resolve(); return f.transport.close() })
  const state = f.transport.setState(active)
  const file = { peer, root: 'd'.repeat(64), size: 100 }
  let finished = false
  const media = ensurePrivateMedia(file).finally(() => { finished = true })
  // Attach a rejection handler immediately so the pre-fix failure is inspectable.
  media.catch(() => {})
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(finished, false, 'startup is a wait, not a download failure')
  held.resolve()
  await state
  assert.equal(downloads, 0, 'contact membership must also be known')
  await f.transport.setPeers([peer])
  await media
  assert.equal(downloads, 1)
})

test('aborting one startup consumer preserves another; cancel and close stop waiting downloads', async t => {
  const held = Promise.withResolvers()
  let downloads = 0
  const f = fixture({ beforeOpen: () => held.promise, fileDownload: async () => { downloads++ } })
  t.after(() => { held.resolve(); return f.transport.close() })
  const state = f.transport.setState(active)
  const peers = f.transport.setPeers([peer])
  const file = { peer, root: 'd'.repeat(64), size: 100 }
  const controller = new AbortController()
  const first = f.transport.download(file, { signal: controller.signal })
  const second = f.transport.download(file)
  controller.abort()
  await assert.rejects(first, { name: 'AbortError' })
  await f.transport.cancelDownload(file)
  await assert.rejects(second, { name: 'AbortError' })
  const third = f.transport.download(file)
  held.resolve()
  await Promise.all([state, peers, third])
  assert.equal(downloads, 1, 'cancelled startup work never reaches the coordinator')
  await f.transport.close()
  await assert.rejects(f.transport.download(file), { name: 'AbortError' })
})

test('startup failures remain errors and a resumed session lets media retry', async t => {
  let fail = true
  const f = fixture({ beforeOpen: async () => { if (fail) throw new Error('STORAGE_UNAVAILABLE') } })
  t.after(() => f.transport.close())
  await f.transport.setPeers([peer])
  await assert.rejects(f.transport.setState(active), /STORAGE_UNAVAILABLE/)
  const file = { peer, root: 'd'.repeat(64), size: 100 }
  await assert.rejects(ensurePrivateMedia(file), /STORAGE_UNAVAILABLE/)
  fail = false
  await f.transport.setState(active)
  await ensurePrivateMedia(file, { manual: true })
  await f.transport.setPeers([])
  await ensurePrivateMedia(file)
  await assert.rejects(ensurePrivateMedia({ ...file, root: 'e'.repeat(64) }), /CHAT_UNAVAILABLE/, 'local reads never authorize remote downloads from a removed contact')
  await f.transport.setState({ ...active, isLocked: true })
  await assert.rejects(ensurePrivateMedia(file), /CHAT_UNAVAILABLE/)
})

test('cached peer originals remain available while transport initialization never finishes', async t => {
  const held = Promise.withResolvers()
  const prepared = await prepareIrfsFile(new Uint8Array(1048577).fill(7))
  const chunks = await Array.fromAsync(prepared.chunks())
  let queries = 0
  let remote = 0
  const f = fixture({
    beforeOpen: () => held.promise,
    fileDownload: async () => { remote++; throw new Error('NETWORK_MUST_NOT_RUN') },
    query: async filter => { queries++; return { results: chunks.filter(chunk => chunk.tags.some(tag => tag[0] === 'd' && tag[1] === filter['#d']?.[0])) } }
  })
  t.after(async () => { held.resolve(); await f.transport.close(); prepared.close() })
  const setup = f.transport.setState(active)
  const file = { peer, root: prepared.root, size: prepared.size }
  await ensurePrivateMedia(file, { signal: AbortSignal.timeout(1000) })
  await ensurePrivateMedia(file, { manual: true, signal: AbortSignal.timeout(1000) })
  assert.equal(queries, chunks.length, 'bubble and click share verified local availability')
  assert.equal(remote, 0)
  held.resolve()
  await setup
})

test('local-only preparation checks self and peer files without waiting for or invoking delivery', async t => {
  const prepared = await prepareIrfsFile(new Uint8Array(51001).fill(9))
  const chunks = await Array.fromAsync(prepared.chunks())
  const stored = new Map(chunks.map(chunk => [chunk.tags.find(tag => tag[0] === 'd')[1], chunk]))
  const f = fixture({
    fileDownload: () => assert.fail('local-only preparation must not request remote bytes'),
    query: async filter => { const chunk = stored.get(filter['#d']?.[0]); return { results: chunk ? [chunk] : [] } }
  })
  t.after(async () => { await f.transport.close(); prepared.close() })
  for (const contact of [owner, peer]) {
    assert.equal(await f.transport.checkLocal({ peer: contact, root: prepared.root, size: prepared.size }), true)
    assert.equal(await f.transport.checkLocal({ peer: contact, root: 'f'.repeat(64), size: prepared.size }), false)
  }
  assert.deepEqual(f.writes, [])
  assert.deepEqual(f.sends, [])
})
