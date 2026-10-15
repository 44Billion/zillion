import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, getEventHash } from 'libp2r2p/event'
import { bytesToBase64, base64ToBytes } from 'libp2r2p/base64'
import { nfileEncode } from 'libp2r2p/nip19'
import { createFileMetadata, decodeFileMetadata } from 'libp2r2p/nip94'
import { chatReferenceUri } from '#services/chat-references.js'
import { createChat } from '#services/self-chat.js'
import { createConversationSummaries } from '#services/conversation-summaries.js'
import { conversationPreview, compareChatMessages } from '#helpers/conversation-preview.js'

const secret = new Uint8Array(32).fill(1)
const owner = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '' }, secret).pubkey
const peer = 'b'.repeat(64)
const other = 'c'.repeat(64)
const inner = (content, createdAt, pubkey = owner) => ({ kind: 9, created_at: createdAt, tags: [], content, pubkey })
const identified = event => ({ ...event, id: getEventHash(event) })
const copy = (event, contact = owner, provenance = '1') => finalizeEvent({
  kind: 1006, created_at: event.created_at,
  tags: [['k', String(event.kind)], ['c', `dm:${contact}`], ['v', provenance], ['o', getEventHash(event)]],
  content: bytesToBase64(new TextEncoder().encode(JSON.stringify(event)))
}, secret)
const matches = (event, filter) => (!filter.kinds || filter.kinds.includes(event.kind)) && (!filter.ids || filter.ids.includes(event.id)) &&
  (!filter['!ids'] || !filter['!ids'].includes(event.id)) && (filter.since == null || event.created_at >= filter.since) && (filter.until == null || event.created_at <= filter.until) &&
  Object.entries(filter).every(([key, values]) => !key.startsWith('#') || event.tags.some(tag => tag[0] === key.slice(1) && values.includes(tag[1])))
const until = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)) }; assert.fail('condition not reached') }

function fixture (t, initial = [], options = {}) {
  const events = new Map(initial.map(event => [event.id, event]))
  const streams = new Set()
  const records = new Map()
  const queries = []
  const subscriptions = []
  const decrypted = []
  const updates = []
  const errors = []
  let decrypt = async (_, kind, scope, content) => { decrypted.push(kind); return base64ToBytes(content).buffer }
  const select = filter => [...events.values()].filter(event => matches(event, filter)).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, filter.limit ?? Infinity)
  const eventStore = {
    async query (filter) { queries.push(filter); const results = select(filter); return { results: filter.ids_only ? results.map(event => event.id) : results } },
    subscribe (filter, options) {
      subscriptions.push({ filter, options })
      const queue = options?.initial ? select(filter).map(event => ({ type: 'event', event })).concat({ type: 'eose' }) : []
      let waiter
      let closed = false
      const stream = {
        filter,
        [Symbol.asyncIterator] () { return this },
        next () { if (closed) return Promise.resolve({ done: true }); return queue.length ? Promise.resolve({ done: false, value: queue.shift() }) : new Promise(resolve => { waiter = resolve }) },
        push (event) { if (waiter) { const resolve = waiter; waiter = null; resolve({ done: false, value: { type: 'event', event } }) } else queue.push({ type: 'event', event }) },
        return () { closed = true; streams.delete(stream); waiter?.({ done: true }); return Promise.resolve({ done: true }) }
      }
      streams.add(stream)
      return stream
    }
  }
  const signer = { obfuscate: async value => value, nip44v3: { decrypt: (...args) => decrypt(...args) } }
  const summaries = createConversationSummaries({
    pubkey: owner, eventStore, signer,
    ...options,
    onChange: (peer, record) => { updates.push({ peer, record }); if (record) records.set(peer, record); else records.delete(peer) },
    onError: error => errors.push(error)
  })
  t.after(() => summaries.close())
  const add = event => { events.set(event.id, event); for (const stream of streams) if (matches(event, stream.filter)) stream.push(event) }
  return { summaries, signer, eventStore, records, queries, subscriptions, decrypted, updates, errors, events, streams, add, decrypt: value => { decrypt = value } }
}

function file (pubkey, caption = '') {
  const url = `https://nostr.alt/${nfileEncode({ root: 'd'.repeat(64), mime: 'image/png', filename: 'vacation.png' })}?localOnly=1`
  return { ...createFileMetadata({ url, mime: 'image/png', service: 'irfs', root: 'd'.repeat(64), size: 42, caption, created_at: 99 }), pubkey }
}

test('cold summaries read only the latest timestamp and its references for self and contacts', async t => {
  const attachment = file(owner)
  const pointer = inner(chatReferenceUri(identified(attachment)), 100)
  const history = [owner, peer].flatMap(contact => Array.from({ length: 80 }, (_, index) => copy(inner(`old ${index}`, index + 1, contact), contact)))
  const f = fixture(t, [...history, copy(attachment), copy(pointer), copy(inner('Latest peer text', 200, peer), peer)])
  await f.summaries.setPeers([peer, other])
  assert.equal(conversationPreview(f.records.get(owner).event, f.records.get(owner).references), 'vacation.png')
  assert.equal(conversationPreview(f.records.get(peer).event, f.records.get(peer).references), 'Latest peer text')
  assert.equal(f.records.get(other).event, null)
  assert.equal(f.decrypted.filter(kind => kind === 9).length, 2, 'older histories are never decrypted')
  assert.equal(f.decrypted.filter(kind => kind === 1063).length, 1)
  assert.ok(f.subscriptions.filter(value => value.options?.initial).every(value => value.filter.limit === 1))
  assert.ok(f.queries.every(filter => !filter.kinds.includes(34601)), 'summary reads never request file bytes')
  assert.deepEqual(f.errors, [])
})

test('new messages, late file metadata and deletions update unopened conversations', async t => {
  const previous = inner('Previous message', 10, peer)
  const f = fixture(t, [copy(previous, peer)])
  await f.summaries.setPeers([peer])
  const attachment = file(peer, 'A caption')
  const latest = inner(chatReferenceUri(identified(attachment)), 100, peer)
  f.add(copy(latest, peer))
  await until(() => f.records.get(peer).event?.created_at === 100)
  assert.equal(conversationPreview(f.records.get(peer).event, f.records.get(peer).references), 'File', 'missing metadata never flashes nevent')
  f.add(copy(attachment, peer))
  await until(() => conversationPreview(f.records.get(peer).event, f.records.get(peer).references) === 'A caption')
  f.events.delete(copy(latest, peer).id)
  f.add(copy({ kind: 5, pubkey: peer, created_at: 200, tags: [['e', getEventHash(latest)], ['k', '9']], content: '' }, peer))
  await until(() => f.records.get(peer).event?.content === 'Previous message')
  f.add(copy(inner('Old backfill', 1, peer), peer))
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(f.records.get(peer).event.content, 'Previous message')
  await f.summaries.setPeers([])
  assert.equal(f.records.has(peer), false)
  assert.equal(f.streams.size, 2, 'only self and shared invalidations remain')
})

test('same-second ties match inner message ordering without loading earlier history or hearsay', async t => {
  const tied = Array.from({ length: 35 }, (_, index) => inner(`tie ${index}`, 100, peer))
  const f = fixture(t, [copy(inner('Old', 1, peer), peer), ...tied.map(event => copy(event, peer)), copy(inner('Hearsay', 200, peer), peer, '2'), copy(inner('Wrong author', 201, other), peer)])
  await f.summaries.setPeers([peer])
  const expected = tied.map(identified).sort(compareChatMessages).at(-1)
  assert.equal(f.records.get(peer).event.id, expected.id)
  assert.ok(f.queries.filter(filter => filter.since === 100).every(filter => filter.limit === 16))
  assert.equal(f.decrypted.length, tied.length + 1)
})

test('read failures can recover, and late metadata cannot replace a newer preview', async t => {
  const attachment = file(peer)
  const original = inner(chatReferenceUri(identified(attachment)), 100, peer)
  const f = fixture(t, [copy(attachment, peer), copy(original, peer)])
  f.decrypt(async () => { throw new Error('LOCKED') })
  await f.summaries.setPeers([peer])
  assert.equal(f.records.get(peer).state, 'unavailable')
  const held = Promise.withResolvers()
  const entered = Promise.withResolvers()
  t.after(() => held.resolve())
  f.decrypt(async (_, kind, scope, content) => { if (kind === 1063) { entered.resolve(); await held.promise }; return base64ToBytes(content).buffer })
  const recover = f.summaries.recover()
  await entered.promise
  f.add(copy(inner('Newer text', 101, peer), peer))
  held.resolve()
  await recover
  await until(() => f.records.get(peer).event?.content === 'Newer text')
  assert.ok(!f.updates.some(update => update.record?.event?.id === getEventHash(original) && update.record.state === 'loaded'), 'stale metadata never completes or replaces the newer preview')
  f.summaries.close()
  assert.equal(f.streams.size, 0)
})

test('pending attachments use their local metadata before the private reference is saved', () => {
  const attachment = file(owner)
  const event = inner(chatReferenceUri(identified(attachment)), 100)
  assert.equal(conversationPreview(event), 'File')
  assert.equal(conversationPreview({ ...event, localAttachment: decodeFileMetadata(attachment) }), 'vacation.png')
  assert.equal(conversationPreview({ ...event, localAttachment: { ...decodeFileMetadata(attachment), caption: 'A  new\ncaption' } }), 'A new\ncaption')
})

for (const contact of [owner, peer]) {
  test(`opening ${contact === owner ? 'self' : 'peer'} chat reuses its latest bubble and metadata before history, without decrypting them again`, async t => {
    const attachment = file(contact, 'Already read caption')
    const latest = inner(chatReferenceUri(identified(attachment)), 100, contact)
    const older = inner('Earlier message', 50, contact)
    const f = fixture(t, [copy(attachment, contact), copy(latest, contact), copy(older, contact)])
    await f.summaries.setPeers([contact])
    const snapshot = f.records.get(contact)
    const held = Promise.withResolvers()
    let loaded = false
    let messages = []
    const references = {}
    const chat = createChat({
      pubkey: owner, peer: contact, eventStore: f.eventStore,
      signer: { ...f.signer, obfuscate: async value => { await held.promise; return value } },
      onMessages: value => { messages = value }, onReference: (id, event) => { references[id] = event },
      onInitialLoad: () => { loaded = true }, onError: error => f.errors.push(error)
    })
    t.after(() => { held.resolve(); chat.close() })
    const starting = chat.start(snapshot)
    assert.equal(loaded, false)
    assert.deepEqual(messages.map(event => event.id), [snapshot.event.id])
    assert.equal(messages[0].status, 'saved')
    assert.equal(references[getEventHash(attachment)], snapshot.references[getEventHash(attachment)])
    assert.equal(await chat.resolveReference({ id: getEventHash(attachment) }), references[getEventHash(attachment)])
    const decryptions = f.decrypted.length
    held.resolve()
    assert.equal(await starting, true)
    assert.equal(loaded, true)
    assert.deepEqual(messages.map(event => event.id), [getEventHash(older), getEventHash(latest)])
    assert.equal(f.decrypted.length, decryptions + 1, 'only the older message needs decryption')
    assert.deepEqual(f.errors, [])
  })
}

test('a reused summary preserves failed-send state and revalidates deleted copies', async t => {
  const latest = inner('Latest persisted message', 100)
  const f = fixture(t, [copy(latest)])
  await f.summaries.setPeers([])
  const snapshot = f.records.get(owner)
  let messages = []
  const chat = createChat({
    pubkey: owner, eventStore: f.eventStore, signer: f.signer, transport: {},
    onMessages: value => { messages = value }, onError: error => f.errors.push(error)
  })
  t.after(() => chat.close())
  chat.applyOutbox([{ id: snapshot.event.id, peer: owner, event: snapshot.event, status: 'error', uploadProgress: 0.4 }])
  const starting = chat.start(snapshot)
  assert.equal(messages[0].status, 'error', 'cached personal copy does not confirm an unfinished send')
  assert.equal(messages[0].uploadProgress, 0.4, 'outbox progress survives the handoff')
  await starting
  assert.equal(messages[0].status, 'error')
  assert.equal(messages.length, 1)
  f.events.clear()
  await chat.start(snapshot)
  assert.deepEqual(messages, [], 'recovery removes the deleted copy instead of restoring the stale summary')
  assert.deepEqual(f.errors, [])
})

test('copies deleted after the summary read do not survive the initial history reconciliation', async t => {
  const latest = inner('Deleted before opening', 100)
  const older = inner('Still present', 50)
  const f = fixture(t, [copy(latest), copy(older)])
  await f.summaries.setPeers([])
  const snapshot = f.records.get(owner)
  f.events.delete(copy(latest).id)
  let messages = []
  const chat = createChat({ pubkey: owner, eventStore: f.eventStore, signer: f.signer, onMessages: value => { messages = value }, onError: error => f.errors.push(error) })
  t.after(() => chat.close())
  const starting = chat.start(snapshot)
  assert.equal(messages[0].id, snapshot.event.id)
  await starting
  assert.deepEqual(messages.map(event => event.content), ['Still present'])
  await chat.start(snapshot)
  assert.deepEqual(messages.map(event => event.content), ['Still present'])
  assert.deepEqual(f.errors, [])
})

test('summary handoff retains all admitted copies of the same message', async t => {
  const latest = inner('Duplicated copy', 100)
  const first = copy(latest)
  const second = finalizeEvent({ ...first, tags: [...first.tags, ['salt', 'second-copy']] }, secret)
  const f = fixture(t, [first, second])
  await f.summaries.setPeers([])
  const snapshot = f.records.get(owner)
  assert.equal(snapshot.copies.length, 2)
  f.events.delete(first.id)
  let messages = []
  const chat = createChat({ pubkey: owner, eventStore: f.eventStore, signer: f.signer, onMessages: value => { messages = value }, onError: error => f.errors.push(error) })
  t.after(() => chat.close())
  await chat.start(snapshot)
  assert.deepEqual(messages.map(event => event.id), [snapshot.event.id], 'one remaining copy keeps the bubble')
  assert.deepEqual(f.errors, [])
})

test('a cached bubble can be deleted while the first history read is still waiting', async t => {
  const latest = inner('Delete before history', 100)
  const f = fixture(t, [copy(latest)])
  await f.summaries.setPeers([])
  const snapshot = f.records.get(owner)
  const held = Promise.withResolvers()
  let messages = []
  let request
  f.eventStore.addPersonalCopy = async event => {
    request = event
    f.events.delete(copy(latest).id)
    return { result: { ok: true } }
  }
  const chat = createChat({
    pubkey: owner, eventStore: f.eventStore,
    signer: { ...f.signer, obfuscate: async value => { await held.promise; return value } },
    onMessages: value => { messages = value }, onError: error => f.errors.push(error)
  })
  t.after(() => { held.resolve(); chat.close() })
  const starting = chat.start(snapshot)
  assert.equal(await chat.deleteMessage(snapshot.event.id), true)
  assert.deepEqual(messages, [])
  assert.equal(request.kind, 5)
  assert.ok(request.tags.some(tag => tag[0] === 'e' && tag[1] === snapshot.event.id))
  held.resolve()
  await starting
  assert.deepEqual(messages, [])
  assert.deepEqual(f.errors, [])
})

for (const contact of [owner, peer]) {
  test(`prefetched ${contact === owner ? 'self' : 'peer'} history and references survive foreground reuse`, async t => {
    const attachment = file(contact, 'Earlier attachment')
    const latest = inner('Latest text', 100, contact)
    const older = inner(chatReferenceUri(identified(attachment)), 50, contact)
    const f = fixture(t, [copy(attachment, contact), copy(latest, contact), copy(older, contact)])
    await f.summaries.setPeers([contact])
    let messages = []
    const references = {}
    const chat = createChat({
      pubkey: owner, peer: contact, eventStore: f.eventStore, signer: f.signer,
      onMessages: value => { messages = value }, onReference: (id, event) => { references[id] = event }, onError: error => f.errors.push(error)
    })
    t.after(() => chat.close())
    const snapshot = f.records.get(contact)
    const first = chat.ensureStarted(snapshot)
    assert.equal(chat.ensureStarted(snapshot), first, 'foreground shares a pending start')
    await first
    await chat.prefetchReferences(new AbortController().signal)
    assert.equal(references[getEventHash(attachment)].content, attachment.content)
    const count = f.subscriptions.length
    const decryptions = f.decrypted.length
    chat.pause()
    assert.equal(await chat.ensureStarted(snapshot), true)
    assert.equal(f.subscriptions.length, count, 'completed prefetch keeps its live subscription')
    assert.equal(f.decrypted.length, decryptions)
    assert.equal(messages.length, 2)
    assert.ok(f.queries.every(filter => !filter.kinds?.includes(34601)), 'references do not read attachment bytes')
    chat.pause(true)
    await chat.ensureStarted(snapshot)
    assert.ok(f.subscriptions.length > count, 'explicit recovery reopens the local snapshot')
    assert.equal(f.decrypted.length, decryptions, 'recovery revalidates retained copies without decrypting again')
    assert.deepEqual(f.errors, [])
  })
}

test('cancelled setup cannot leak a subscription or clear the resumed start', async t => {
  const f = fixture(t, [copy(inner('Hello', 100))])
  const held = Promise.withResolvers()
  const reached = Promise.withResolvers()
  let calls = 0
  const chat = createChat({
    pubkey: owner, eventStore: f.eventStore,
    signer: { ...f.signer, async obfuscate (value) { if (++calls === 2) { reached.resolve(); await held.promise }; return value } },
    onMessages () {}, onError: error => f.errors.push(error)
  })
  t.after(() => { held.resolve(); chat.close() })
  const first = chat.ensureStarted()
  await reached.promise
  chat.pause()
  const resumed = chat.ensureStarted()
  held.resolve()
  assert.equal(await first, false)
  assert.equal(await resumed, true)
  assert.equal(f.subscriptions.length, 2, 'only resumed deletion/history subscriptions exist')
  assert.deepEqual(f.errors, [])
})

test('the authoritative message is published before slow reference metadata', async t => {
  const attachment = file(peer, 'A caption')
  const message = inner(chatReferenceUri(identified(attachment)), 100, peer)
  const f = fixture(t, [copy(message, peer), copy(attachment, peer)])
  const gate = Promise.withResolvers()
  t.after(() => gate.resolve())
  f.decrypt(async (_, kind, scope, content) => { if (kind === 1063) await gate.promise; return base64ToBytes(content).buffer })
  const reading = f.summaries.setPeers([peer])
  await until(() => f.records.get(peer)?.messageReady)
  assert.equal(f.records.get(peer).state, 'loading')
  assert.equal(f.records.get(peer).verified, true)
  assert.equal(conversationPreview(f.records.get(peer).event, f.records.get(peer).references), 'File')
  gate.resolve(); await reading
  assert.equal(conversationPreview(f.records.get(peer).event, f.records.get(peer).references), 'A caption')
})

test('a warm projection restores once, validates source copies and avoids repeated message/reference decryption', async t => {
  let stored = []
  const cache = { read: async () => stored, write: async value => { stored = value }, close: async () => {} }
  const attachment = file(peer, 'Cached caption')
  const message = inner(chatReferenceUri(identified(attachment)), 100, peer)
  const initial = [copy(message, peer), copy(attachment, peer)]
  const first = fixture(t, initial, { cache })
  await first.summaries.setPeers([peer]); await first.summaries.flush()
  assert.equal(stored.length, 1)
  const restored = []
  const second = fixture(t, initial, { cache, onRestore: values => restored.push(values) })
  await second.summaries.setPeers([peer])
  assert.equal(restored.length, 1)
  assert.equal(restored[0][peer].verified, false)
  assert.equal(second.records.get(peer).verified, true)
  assert.equal(conversationPreview(second.records.get(peer).event, second.records.get(peer).references), 'Cached caption')
  assert.deepEqual(second.decrypted, [], 'existing copies and references reuse their admitted plaintext')
  assert.ok(second.queries.some(filter => filter.ids_only), 'cache adoption still checks authoritative existence')
})

test('deleted cached copies cannot seed a foreground bubble; remaining history replaces the projection', async t => {
  const latest = inner('Deleted cached message', 100, peer)
  const older = inner('Still present', 50, peer)
  const snapshot = { peer, context: `dm:${peer}`, event: identified(latest), copies: [{ id: copy(latest, peer).id, created_at: 100 }], references: {}, sources: {} }
  const cache = { read: async () => [snapshot], write: async () => {}, close: async () => {} }
  const f = fixture(t, [copy(older, peer)], { cache })
  const gate = Promise.withResolvers()
  const query = f.eventStore.query
  f.eventStore.query = async filter => { if (filter.ids_only) await gate.promise; return query(filter) }
  t.after(() => gate.resolve())
  const reading = f.summaries.setPeers([peer])
  await until(() => f.records.get(peer)?.state === 'cached')
  let messages = []
  const chat = createChat({ pubkey: owner, peer, eventStore: f.eventStore, signer: { ...f.signer, obfuscate: async value => { await gate.promise; return value } }, onMessages: value => { messages = value }, onError: error => f.errors.push(error) })
  t.after(() => chat.close())
  const starting = chat.start(f.records.get(peer))
  assert.deepEqual(messages, [], 'an unverified persistent cache is presentation only')
  gate.resolve(); await reading; await starting
  assert.equal(f.records.get(peer).event.content, 'Still present')
  assert.deepEqual(messages.map(event => event.content), ['Still present'])
})

test('cache failures and late snapshots cannot delay or overwrite fresh summaries', async t => {
  const latest = inner('Fresh source', 200, peer)
  const cache = { read: async () => { throw new Error('cache denied') }, write: async () => { throw new Error('quota') }, close: async () => {} }
  const f = fixture(t, [copy(latest, peer)], { cache })
  await f.summaries.setPeers([peer]); await f.summaries.flush()
  assert.equal(f.records.get(peer).event.content, 'Fresh source')
  assert.equal(f.errors.length, 2)
  const gate = Promise.withResolvers()
  const second = fixture(t, [copy(latest, peer)], { cache: { ...cache, read: () => gate.promise, write: async () => {} } })
  await second.summaries.setPeers([peer])
  gate.resolve([{ peer, context: `dm:${peer}`, event: identified(inner('Stale snapshot', 100, peer)), copies: [{ id: 'f'.repeat(64), created_at: 100 }], references: {}, sources: {} }])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(second.records.get(peer).event.content, 'Fresh source')
})

test('missing cached reference copies drop old captions without discarding the still-present message', async t => {
  const attachment = file(peer, 'Removed caption')
  const message = inner(chatReferenceUri(identified(attachment)), 100, peer)
  const referenceId = getEventHash(attachment)
  const snapshot = {
    peer, context: `dm:${peer}`, event: identified(message), copies: [{ id: copy(message, peer).id, created_at: 100 }],
    references: { [referenceId]: identified(attachment) }, sources: { [referenceId]: { personal: true, ids: [copy(attachment, peer).id] } }
  }
  const cache = { read: async () => [snapshot], write: async () => {}, close: async () => {} }
  const f = fixture(t, [copy(message, peer)], { cache })
  await f.summaries.setPeers([peer])
  assert.equal(f.records.get(peer).event.id, getEventHash(message))
  assert.deepEqual(f.records.get(peer).references, {})
  assert.equal(conversationPreview(f.records.get(peer).event, f.records.get(peer).references), 'File')
  assert.deepEqual(f.decrypted, [])
})

test('new source messages supersede an existing cached preview while decrypting only the new message', async t => {
  const cached = inner('Cached old message', 100, peer)
  const latest = inner('New source message', 200, peer)
  const cache = { read: async () => [{ peer, context: `dm:${peer}`, event: identified(cached), copies: [{ id: copy(cached, peer).id, created_at: 100 }], references: {}, sources: {} }], write: async () => {}, close: async () => {} }
  const f = fixture(t, [copy(cached, peer), copy(latest, peer)], { cache })
  await f.summaries.setPeers([peer])
  assert.equal(f.records.get(peer).event.content, 'New source message')
  assert.deepEqual(f.decrypted, [9])
})

test('closing an account fences a pending persistent-cache restore', async t => {
  const gate = Promise.withResolvers()
  const restored = []
  const f = fixture(t, [], { cache: { read: () => gate.promise, write: async () => {}, close: async () => {} }, onRestore: values => restored.push(values) })
  const reading = f.summaries.setPeers([peer])
  await f.summaries.close()
  const cached = inner('Old account message', 100, peer)
  gate.resolve([{ peer, context: `dm:${peer}`, event: identified(cached), copies: [{ id: copy(cached, peer).id, created_at: 100 }], references: {}, sources: {} }])
  await reading
  assert.deepEqual(restored, [])
  assert.equal(f.streams.size, 0)
})

test('an empty cold account does not encrypt or create a useless snapshot', async t => {
  let writes = 0
  const cache = { read: async () => [], write: async () => { writes++ }, close: async () => {} }
  const f = fixture(t, [], { cache })
  await f.summaries.setPeers([peer]); await f.summaries.flush()
  assert.equal(writes, 0)
})

test('a late cache restore validates independently of held initial-summary delivery', async t => {
  const cached = inner('Late cached message', 100, peer)
  const local = copy(cached, peer)
  const cacheGate = Promise.withResolvers()
  const sourceGate = Promise.withResolvers()
  t.after(() => { cacheGate.resolve([]); sourceGate.resolve() })
  const f = fixture(t, [local], { cache: { read: () => cacheGate.promise, write: async () => {}, close: async () => {} } })
  const subscribe = f.eventStore.subscribe
  f.eventStore.subscribe = (filter, options) => {
    const stream = subscribe(filter, options)
    if (!options?.initial) return stream
    return { [Symbol.asyncIterator] () { return this }, async next () { await sourceGate.promise; return stream.next() }, return: () => stream.return() }
  }
  const reading = f.summaries.setPeers([peer])
  await new Promise(resolve => setTimeout(resolve, 270))
  cacheGate.resolve([{ peer, context: `dm:${peer}`, event: identified(cached), copies: [{ id: local.id, created_at: 100 }], references: {}, sources: {} }])
  await until(() => f.records.get(peer)?.verified === true)
  assert.equal(f.records.get(peer).state, 'cached')
  assert.equal(f.records.get(peer).messageReady, false)
  assert.deepEqual(f.decrypted, [], 'the late snapshot becomes eligible without its ordinary read')
  sourceGate.resolve(); await reading
  assert.equal(f.records.get(peer).state, 'loaded')
  assert.deepEqual(f.decrypted, [])
})

function mobileViewport (t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  let mobile = true
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: mobile }) })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'matchMedia', original); else delete globalThis.matchMedia })
  return () => { mobile = false }
}
const flush = async () => { for (let n = 0; n < 8; n++) await new Promise(resolve => setImmediate(resolve)) }

test('mobile restores a 600ms cache before source readers start, without repeating message decryption', async t => {
  mobileViewport(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = Promise.withResolvers()
  t.after(() => gate.resolve([]))
  const message = inner('Cached mobile message', 100, peer)
  const wrapper = copy(message, peer)
  const f = fixture(t, [wrapper], { cache: { read: () => gate.promise, write: async () => {}, close: async () => {} } })
  const reading = f.summaries.setPeers([peer])
  await flush()
  t.mock.timers.tick(600); await flush()
  assert.equal(f.subscriptions.length, 0)
  gate.resolve([{ peer, context: `dm:${peer}`, event: identified(message), copies: [{ id: wrapper.id, created_at: 100 }], references: {}, sources: {} }])
  await reading
  assert.equal(f.records.get(peer).event.id, identified(message).id)
  assert.deepEqual(f.decrypted, [])
})

test('mobile cache timeout is capped at 1.5 seconds and does not change during resize', async t => {
  const resize = mobileViewport(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = Promise.withResolvers()
  t.after(() => gate.resolve([]))
  const f = fixture(t, [], { cache: { read: () => gate.promise, write: async () => {}, close: async () => {} } })
  const reading = f.summaries.setPeers([peer])
  await flush()
  resize()
  t.mock.timers.tick(1499); await flush()
  assert.equal(f.subscriptions.length, 0)
  t.mock.timers.tick(1)
  await reading
  assert.ok(f.subscriptions.some(value => value.options?.initial))
})

test('a ready mobile snapshot has no minimum bootstrap wait', async t => {
  mobileViewport(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t, [], { cache: { read: async () => [], write: async () => {}, close: async () => {} } })
  await f.summaries.setPeers([peer])
  assert.ok(f.subscriptions.some(value => value.options?.initial), 'ready cache starts readers without advancing timers')
})

test('early preparation decrypts once without publishing until current contacts are confirmed', async t => {
  const message = inner('Prepared before contacts', 100, peer)
  const unknown = inner('Removed contact', 110, other)
  const row = (event, contact) => ({ peer: contact, context: `dm:${contact}`, event: identified(event), copies: [{ id: copy(event, contact).id, created_at: event.created_at }], references: {}, sources: {} })
  let reads = 0
  const f = fixture(t, [copy(message, peer)], { cache: { read: async () => { reads++; return [row(message, peer), row(unknown, other)] }, write: async () => {}, close: async () => {} } })
  await f.summaries.prepare()
  assert.equal(reads, 1)
  assert.equal(f.records.size, 0)
  assert.equal(f.subscriptions.length, 0, 'preparation never opens source subscriptions')
  const reading = f.summaries.setPeers([peer])
  assert.equal(f.records.get(peer).event.content, 'Prepared before contacts', 'prepared rows publish immediately on membership confirmation')
  assert.equal(f.records.has(other), false)
  assert.equal(f.records.get(peer).verified, false)
  await reading
  assert.equal(reads, 1)
  assert.deepEqual(f.decrypted, [])
})

test('waiting for contacts does not restart the cache budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const cache = Promise.withResolvers()
  const f = fixture(t, [], { cacheTimeout: 250, cache: { read: () => cache.promise, write: async () => {}, close: async () => {} } })
  t.after(() => cache.resolve([]))
  const preparing = f.summaries.prepare()
  await flush()
  t.mock.timers.tick(250); await preparing
  const reading = f.summaries.setPeers([peer])
  await flush()
  assert.ok(f.subscriptions.some(value => value.options?.initial), 'ordinary readers start without another 250ms wait')
  await reading
})

test('locking invalidates pending cache plaintext and allows a fresh preparation on unlock', async t => {
  const first = Promise.withResolvers()
  const second = Promise.withResolvers()
  const restored = []
  let reads = 0
  const f = fixture(t, [], { cache: { read: () => ++reads === 1 ? first.promise : second.promise, write: async () => {}, close: async () => {} }, onRestore: values => restored.push(values) })
  const old = f.summaries.setPeers([peer])
  await flush()
  f.summaries.suspend()
  await old
  const message = inner('Old pending plaintext', 100, peer)
  first.resolve([{ peer, context: `dm:${peer}`, event: identified(message), copies: [{ id: copy(message, peer).id, created_at: 100 }], references: {}, sources: {} }])
  await flush()
  assert.deepEqual(restored, [])
  assert.equal(f.subscriptions.length, 0)
  const prepared = f.summaries.prepare()
  await flush()
  assert.equal(reads, 2)
  second.resolve([]); await prepared
  assert.deepEqual(restored, [], 'a renewed warm read also waits for membership confirmation')
  await f.summaries.setPeers([])
  assert.deepEqual(restored, [{}])
})

test('recovery adopts prepared cache only for the newly confirmed contact set', async t => {
  const restored = []
  const message = inner('Current contact', 100, peer)
  const removed = inner('Removed during lock', 110, other)
  const row = (event, contact) => ({ peer: contact, context: `dm:${contact}`, event: identified(event), copies: [{ id: copy(event, contact).id, created_at: event.created_at }], references: {}, sources: {} })
  let stored = []
  const f = fixture(t, [copy(message, peer)], { cache: { read: async () => stored, write: async () => {}, close: async () => {} }, onRestore: values => restored.push(values) })
  await f.summaries.setPeers([other])
  f.summaries.suspend()
  stored = [row(message, peer), row(removed, other)]
  await f.summaries.prepare()
  restored.length = 0
  await f.summaries.recover([peer])
  assert.deepEqual(Object.keys(restored[0]), [peer])
  assert.equal(f.records.has(other), false)
  assert.ok(f.records.get(peer).event)
})
