import { prepareIrfsFile, decodeIrfsChunk } from 'libp2r2p/irfs'
import { nfileEncode } from 'libp2r2p/nip19'
import { createFileMetadata } from 'libp2r2p/nip94'
import { attachmentCatalog } from '#services/chat-attachments.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, getEventHash } from 'libp2r2p/event'
import { bytesToBase64, base64ToBytes, bytesToBase64Url } from 'libp2r2p/base64'
import { createSelfChat } from '#services/self-chat.js'
import { parseChatContent } from '#helpers/chat-content.js'

const secret = new Uint8Array(32).fill(1)
const pubkey = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '' }, secret).pubkey
const inner = (text, at = 10) => ({ kind: 9, created_at: at, content: text, tags: [] })
function wrapper (event, context = `dm:${pubkey}`, provenance = '1') {
  return finalizeEvent({ kind: 1006, created_at: event.created_at, tags: [['k', String(event.kind)], ['c', context], ['v', provenance], ['o', getEventHash({ ...event, pubkey })], ...event.tags.filter(tag => tag[0] === 'r').map(tag => ['o', tag[1]])], content: bytesToBase64(new TextEncoder().encode(JSON.stringify(event))) }, secret)
}
function fixture (history = [], options = {}) {
  let deliver
  let deliverDeletion
  let returned = false
  let initial = []
  const writes = []
  const errors = []
  let messages = []
  let initialMessages = null
  const subscription = {
    [Symbol.asyncIterator] () { return this },
    next: () => initial.length ? Promise.resolve({ value: initial.shift(), done: false }) : new Promise(resolve => { deliver = resolve }),
    return: async () => { returned = true; deliver?.({ done: true }); return { done: true } }
  }
  const deletionSubscription = {
    [Symbol.asyncIterator] () { return this },
    next: () => new Promise(resolve => { deliverDeletion = resolve }),
    return: async () => { deliverDeletion?.({ done: true }); return { done: true } }
  }
  const publicEvents = options.publicEvents ?? []
  const eventStore = {
    subscribe (filter, options) {
      if (filter['#k'][0] === '9') {
        assert.deepEqual(options, { initial: true })
        initial = [...history.filter(event => event.tags.some(tag => tag[0] === 'k' && tag[1] === '9')).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, 50).map(event => ({ type: 'event', event })), { type: 'eose' }]
        assert.deepEqual(filter, { kinds: [1006], authors: [pubkey], '#k': ['9'], '#c': [`dm:${pubkey}`], '#v': ['0', '1'], limit: 50 })
        return subscription
      }
      assert.deepEqual(filter, {
        kinds: [1006],
        authors: [pubkey],
        '#k': ['5'],
        '#c': [`dm:${pubkey}`],
        '#v': ['0', '1'],
        '#o': ['9', '1063']
      })
      return deletionSubscription
    },
    query: async (filter = {}) => {
      if (filter.ids) return { results: publicEvents.filter(event => filter.ids.includes(event.id)) }
      return {
        results: history.filter(event => (!filter.kinds || filter.kinds.includes(event.kind)) &&
        Object.entries(filter).every(([key, values]) => !key.startsWith('#') || event.tags.some(tag => tag[0] === key.slice(1) && values.includes(tag[1])))).slice(0, filter.limit)
      }
    },
    addPersonalCopy: async (event, options) => {
      writes.push({ event, options })
      if (event.kind === 5) {
        const ids = event.tags.filter(tag => tag[0] === 'e').map(tag => tag[1])
        history = history.filter(copy => !copy.tags.some(tag => tag[0] === 'c' && tag[1] === options.context) || !copy.tags.some(tag => tag[0] === 'o' && ids.includes(tag[1])))
      }
      const copy = wrapper(event, options.context)
      if (!history.some(event => event.id === copy.id)) history.push(copy)
      return { result: { ok: true, stored: true } }
    }
  }
  const chat = createSelfChat({ pubkey, eventStore, signer: { obfuscate: async value => value, nip44v3: { decrypt: async (owner, kind, scope, content) => base64ToBytes(content).buffer } }, onMessages: value => { messages = value }, onError: error => errors.push(error), onInitialLoad: () => { initialMessages = messages }, ...options })
  return {
    chat, writes, errors, eventStore,
    get initialMessages () { return initialMessages },
    get messages () { return messages },
    get returned () { return returned },
    deliver: event => deliver({ done: false, value: { type: 'event', event } }),
    deliverDeletion: event => deliverDeletion({ done: false, value: { type: 'event', event } })
  }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10))

test('self history and live copies deduplicate, order by inner ID and exclude hearsay, other authors and contexts', async () => {
  const first = inner('Private note')
  const f = fixture([wrapper(first), wrapper(inner('Not a chat'), ''), wrapper({ ...inner('Hearsay'), pubkey: 'b'.repeat(64) }, `dm:${pubkey}`, '2')])
  await f.chat.start()
  assert.equal(f.messages.length, 1)
  assert.equal(f.initialMessages, f.messages, 'initial completion follows decryption and delivery')
  assert.equal(f.messages[0].id, getEventHash({ ...first, pubkey }))
  f.deliver(wrapper(first)); await tick()
  assert.equal(f.messages.length, 1)
  f.deliver(wrapper(inner('Earlier note', 5))); await tick()
  assert.deepEqual(f.messages.map(event => event.content), ['Private note'], 'older backfills do not automatically load history')
  f.chat.close(); await tick()
  assert.equal(f.returned, true)
  assert.deepEqual(f.errors, [])
})

test('saving uses only personal copies, preserves text, quotes inner IDs with an empty relay hint and retries the same event', async () => {
  const f = fixture([wrapper(inner('Parent'))])
  await f.chat.start()
  const parent = f.messages[0].id
  const reply = f.chat.send('Reply\nhttps://example.com/image.png', parent)
  assert.equal(f.messages.find(message => message.id === reply).status, 'pending')
  await f.chat.retry(reply)
  assert.equal(f.messages.find(message => message.id === reply).status, 'saved')
  assert.deepEqual(f.writes[0].options, { context: `dm:${pubkey}` })
  assert.deepEqual(f.writes[0].event.tags[0], ['q', parent, '', pubkey])
  assert.equal(f.writes[0].event.kind, 9)
  assert.match(f.writes[0].event.tags.find(tag => tag[0] === 'salt')[1], /^[A-Za-z0-9_-]{16}$/)
  assert.equal(f.writes[0].event.sig, undefined)
  // The replied message is referenced by a NIP-21 URI first, then the text.
  const [pointer, ...text] = f.writes[0].event.content.split('\n')
  const [parsed] = parseChatContent(pointer)
  assert.equal(parsed.key, 'event')
  assert.equal(parsed.event.id, parent)
  assert.equal(parsed.event.kind, 9)
  assert.match(parsed.event.original, /^nostr:nevent1/)
  assert.equal(text.join('\n'), 'Reply\nhttps://example.com/image.png')
  const write = f.eventStore.addPersonalCopy
  let failed
  f.eventStore.addPersonalCopy = async event => { failed = event; return { result: { ok: false, code: 'invalid' } } }
  const failedId = f.chat.send('Retry')
  await f.chat.retry(failedId)
  assert.equal(f.messages.length, 3)
  assert.equal(f.messages.find(message => message.id === failedId).status, 'error')
  f.eventStore.addPersonalCopy = write
  await f.chat.retry(failedId)
  assert.deepEqual(f.writes.at(-1).event, failed)
  assert.equal(f.messages.find(message => message.id === failedId).status, 'saved')
  const repeatedId = f.chat.send('Retry')
  assert.notEqual(repeatedId, failedId)
  await f.chat.retry(repeatedId)
  assert.notDeepEqual(f.writes.at(-1).event.tags, failed.tags, 'identical intentional sends remain distinct within one second')
  f.chat.close()
})

test('concurrent sends and retries keep stable IDs, and live confirmation wins over a late rejection', async () => {
  const f = fixture()
  await f.chat.start()
  const attempts = []
  f.eventStore.addPersonalCopy = event => new Promise((resolve, reject) => attempts.push({ event, resolve, reject }))
  const first = f.chat.send('Same text')
  const second = f.chat.send('Same text', first)
  assert.notEqual(first, second)
  assert.deepEqual(f.messages.map(message => message.status), ['pending', 'pending'])
  await tick()
  assert.equal(attempts.length, 2)
  assert.deepEqual(attempts[1].event.tags[0], ['q', first, '', pubkey])
  attempts[1].resolve({ result: { ok: true } })
  attempts[0].reject(new Error('Permission denied'))
  await tick()
  const status = id => f.messages.find(message => message.id === id).status
  assert.equal(status(first), 'error')
  assert.equal(status(second), 'saved')
  const retried = f.chat.retry(first)
  assert.equal(f.chat.retry(first), retried, 'repeated clicks share the in-flight attempt')
  assert.equal(status(first), 'pending')
  await tick()
  assert.equal(attempts.length, 3)
  assert.deepEqual(attempts[2].event, attempts[0].event)
  assert.deepEqual(Object.keys(attempts[2].event).sort(), ['content', 'created_at', 'kind', 'tags'], 'UI state never enters the stored event')
  f.deliver(wrapper(attempts[2].event))
  await tick()
  assert.equal(status(first), 'saved')
  attempts[2].reject(new Error('Late bridge failure'))
  await retried
  assert.equal(status(first), 'saved')
  await f.chat.retry(first)
  assert.equal(attempts.length, 3, 'confirmed messages cannot be retried')
  f.deliver(wrapper(attempts[2].event))
  await tick()
  assert.equal(f.messages.length, 2)
  assert.deepEqual(f.errors, [], 'write errors belong to their bubbles, not history loading')
  f.chat.close()
})

test('sending compacts content before hashing, outbox acceptance and persistence, and retry keeps that event', async () => {
  const f = fixture()
  await f.chat.start()
  const attempts = []
  f.eventStore.addPersonalCopy = async event => {
    attempts.push(event)
    return { result: { ok: attempts.length > 1 } }
  }
  const id = f.chat.send('  Hello\t  world \r\n\n\n\n https://example.com/photo.png#dim=640x480  ')
  const content = 'Hello world\n\nhttps://example.com/photo.png#dim=640x480'
  assert.equal(f.messages[0].content, content)
  assert.equal(f.messages[0].status, 'pending')
  assert.equal(id, getEventHash(f.messages[0]))
  await f.chat.retry(id)
  assert.equal(attempts[0].content, content)
  assert.equal(f.messages[0].status, 'error')
  await f.chat.retry(id)
  assert.equal(attempts[1], attempts[0])
  assert.equal(f.messages[0].status, 'saved')
  assert.equal(f.messages[0].id, id)
  f.chat.close()

  const reopened = fixture([wrapper(attempts[0])])
  await reopened.chat.start()
  assert.equal(reopened.messages[0].content, content)
  assert.equal(reopened.messages[0].id, id)
  reopened.chat.close()
})

test('closing suppresses late write results and rejects new drafts before accepting them', async () => {
  const f = fixture()
  await f.chat.start()
  const completion = Promise.withResolvers()
  f.eventStore.addPersonalCopy = () => completion.promise
  assert.equal(f.chat.send('  '), undefined)
  assert.throws(() => f.chat.send('Reply', 'unknown'), /Unknown reply/)
  const id = f.chat.send('Still saving')
  await tick()
  const snapshot = f.messages
  f.chat.close()
  completion.resolve({ result: { ok: true } })
  await tick()
  assert.equal(f.messages, snapshot)
  assert.equal(f.messages[0].id, id)
  assert.throws(() => f.chat.send('Too late'), /closed/)
})

test('NIP-27 preserves text and distinguishes images, videos, links and hashtags', () => {
  const parts = parseChatContent('Photo https://example.com/a.png and https://example.com/v.mp4 #nostr')
  assert.deepEqual(parts.filter(part => part.key === 'url').map(part => part.url.m), ['image/png', 'video/mp4'])
  assert.equal(parts.at(-1).key, 'hashtag')
  assert.equal(parseChatContent('<script>alert(1)</script>')[0].text.value, '<script>alert(1)</script>')
  assert.equal(parseChatContent('https://example.com/file#m=image%2Fpng')[0].url.m, 'image/png')
})

test('files are prepared without writes, chunks settle before metadata, and retry retains the exact event', async () => {
  const prepared = await prepareIrfsFile(new Uint8Array(102001).fill(23))
  const metadata = { root: prepared.root, size: prepared.size, mime: 'image/png', filename: 'test.png', width: 2, height: 1, thumbhash: 'AQID', service: 'irfs', url: `https://nostr.alt/${nfileEncode({ root: prepared.root, mime: 'image/png', filename: 'test.png' })}?localOnly=1` }
  let verified = 0
  let released = 0
  const f = fixture([], { verifyFile: async file => { assert.equal(file.url, metadata.url); verified++ } })
  await f.chat.start()
  assert.equal(f.writes.length, 0)
  const chunks = new Map()
  let fail = true
  const query = f.eventStore.query
  const add = f.eventStore.addPersonalCopy
  f.eventStore.query = async filter => filter.kinds[0] === 34601 ? { results: [chunks.get(filter['#d'][0])].filter(Boolean) } : query(filter)
  f.eventStore.addPersonalCopy = async (event, options) => {
    if (event.kind === 34601) {
      f.writes.push({ event, options })
      const chunk = decodeIrfsChunk(event)
      if (fail && chunk.index === 1) return { result: { ok: false, code: 'QUOTA' } }
      chunks.set(event.tags[0][1], event)
    } else { assert.equal(chunks.size, 3); assert.equal(verified, 1); return add(event, options) }
    return { result: { ok: true } }
  }
  const id = f.chat.send('', null, { prepared, metadata, close: () => { released++; prepared.close() } })
  await f.chat.retry(id)
  assert.equal(f.messages[0].status, 'error')
  // Every message is a kind 9; the file metadata is its own event written first.
  assert.equal(f.messages[0].kind, 9)
  assert.equal(f.writes.filter(({ event }) => event.kind === 1063).length, 0)
  const original = { ...f.messages[0] }
  fail = false
  await f.chat.retry(id)
  assert.equal(f.messages[0].status, 'saved')
  assert.equal(f.messages[0].id, original.id)
  assert.equal(f.messages[0].created_at, original.created_at)
  assert.deepEqual(f.messages[0].tags, original.tags)
  assert.equal(released, 1)
  assert.equal(f.writes.filter(({ event }) => event.kind === 34601).length, 4, 'only the missing chunk is retried')
  const before = f.writes.length
  verified = 0
  f.chat.send('  reuse   caption ', id, { metadata: { ...metadata, download: '1' } })
  await f.chat.retry(f.messages.find(message => message.id !== id).id)
  assert.equal(f.writes.length, before + 2, 'reuse writes the file metadata and its kind 9')
  const [fileWrite, messageWrite] = f.writes.slice(-2)
  assert.equal(fileWrite.event.kind, 1063)
  assert.equal(fileWrite.event.content, 'reuse caption')
  assert.equal(fileWrite.event.tags.some(tag => tag[0] === 'download'), false, 'sending does not propagate received download intent')
  assert.equal(messageWrite.event.kind, 9)
  assert.deepEqual(messageWrite.event.tags.filter(tag => tag[0] === 'q').map(tag => tag[1]), [id, getEventHash({ ...fileWrite.event, pubkey })])
  const pointers = messageWrite.event.content.split('\n').map(pointer => parseChatContent(pointer)[0])
  assert.deepEqual(pointers.map(pointer => pointer.event.id), [id, getEventHash({ ...fileWrite.event, pubkey })])
  assert.equal(messageWrite.event.content.includes('reuse caption'), false, 'caption lives only on the file metadata')
  f.chat.close()
})

test('1063 history stays out of the feed and fills the attachment catalog from the store', async () => {
  const metadata = { root: 'ab'.repeat(32), size: 1, mime: 'image/png', filename: 'one.png', width: 1, height: 1, service: 'irfs', url: `https://nostr.alt/${nfileEncode({ root: 'ab'.repeat(32), mime: 'image/png', filename: 'one.png' })}?localOnly=1` }
  const first = createFileMetadata({ ...metadata, created_at: 1 })
  const recent = createFileMetadata({ ...metadata, caption: 'Recent', created_at: 2 })
  const f = fixture([wrapper(first, ''), wrapper(recent, ''), wrapper({ ...recent, content: 'Conversation only', created_at: 3 })])
  await f.chat.start()
  assert.equal(f.messages.length, 0, 'file metadata no longer becomes a bubble')
  const catalog = attachmentCatalog(await f.chat.readFiles())
  assert.equal(catalog.length, 1)
  assert.equal(catalog[0].caption, 'Recent')
  assert.equal(attachmentCatalog((await f.chat.readFiles()).map(event => ({ ...event, status: 'error' }))).length, 0)
  f.chat.close()
})

test('private deletion envelopes remove matching messages from the local list', async () => {
  const removed = []
  const keep = inner('Keep me', 10)
  const target = inner('Delete me', 11)
  const f = fixture([wrapper(keep), wrapper(target)], { onDelete: ids => removed.push(...ids) })
  await f.chat.start()
  const targetId = f.messages.find(message => message.content === 'Delete me').id

  const request = { kind: 5, created_at: 12, tags: [['e', targetId], ['k', '9']], content: '' }
  f.deliverDeletion(wrapper(request))
  await tick()

  assert.deepEqual(removed, [targetId])
  f.chat.close()
})

test('deleting a message removes it optimistically and restores it when the request fails', async () => {
  const f = fixture([wrapper(inner('Delete me', 10)), wrapper(inner('Survivor', 11))])
  await f.chat.start()
  const id = f.messages.find(message => message.content === 'Delete me').id

  const deleting = f.chat.deleteMessage(id)
  assert.equal(f.messages.some(message => message.id === id), false, 'message leaves the list before the write settles')
  assert.equal(await deleting, true)
  const request = f.writes.at(-1).event
  assert.equal(request.kind, 5)
  assert.deepEqual(request.tags, [['e', id], ['k', '9']])

  f.eventStore.addPersonalCopy = async () => ({ result: { ok: false, code: 'quota' } })
  const survivor = f.messages.find(message => message.content === 'Survivor')
  assert.equal(await f.chat.deleteMessage(survivor.id), false)
  assert.equal(f.messages.some(message => message.id === survivor.id), true, 'failed deletion restores the message')
  f.chat.close()
})

test('history recovery shares work, retains failed outbox entries, and waits for decryption', async () => {
  const states = []
  let locked = true
  const decrypted = Promise.withResolvers()
  const f = fixture([wrapper(inner('Recovered'))], {
    onHistoryState: state => states.push(state),
    signer: {
      obfuscate: async value => { if (locked) throw new Error('VAULT_LOCKED'); return value },
      nip44v3: { decrypt: async (owner, kind, scope, content) => { await decrypted.promise; return base64ToBytes(content).buffer } }
    }
  })
  assert.equal(await f.chat.start(), false)
  assert.deepEqual(states, ['loading', 'unavailable'])
  f.eventStore.addPersonalCopy = async () => ({ result: { ok: false } })
  const id = f.chat.send('Keep my draft')
  await f.chat.retry(id)
  const failed = f.messages[0]
  locked = false
  const first = f.chat.start()
  assert.equal(f.chat.start(), first)
  await tick()
  assert.equal(states.at(-1), 'loading')
  assert.equal(f.initialMessages, null)
  decrypted.resolve()
  assert.equal(await first, true)
  assert.equal(states.at(-1), 'loaded')
  assert.deepEqual(f.messages.find(message => message.id === id), failed)
  f.eventStore.addPersonalCopy = async event => { assert.equal(getEventHash({ ...event, pubkey }), id); return { result: { ok: true } } }
  await f.chat.retry(id)
  assert.equal(f.messages.find(message => message.id === id).status, 'saved')
  f.chat.close()
})

test('recovering subscriptions ignores replaced streams and late decryptions after close', async () => {
  const f = fixture()
  const streams = []
  f.eventStore.subscribe = (filter, options) => {
    let initial = !!options?.initial
    let next = Promise.withResolvers()
    const stream = {
      returned: false,
      [Symbol.asyncIterator] () { return this },
      next: () => { if (initial) { initial = false; return Promise.resolve({ value: { type: 'eose' }, done: false }) }; return next.promise },
      emit: result => { const previous = next; next = Promise.withResolvers(); previous.resolve({ value: { type: 'event', event: result }, done: false }) },
      return: async () => { stream.returned = true; next.resolve({ done: true }); return { done: true } }
    }
    streams.push(stream)
    return stream
  }
  await f.chat.start()
  await f.chat.start()
  assert.equal(streams[0].returned, true)
  assert.equal(streams[1].returned, true)
  assert.deepEqual(f.errors, [])
  streams[3].emit(wrapper(inner('Current stream')))
  await tick()
  assert.equal(f.messages[0].content, 'Current stream')
  f.chat.close()
  assert.equal(streams[2].returned, true)

  const decrypt = Promise.withResolvers()
  const closed = fixture([wrapper(inner('Stale'))], { signer: { obfuscate: async value => value, nip44v3: { decrypt: () => decrypt.promise } } })
  const loading = closed.chat.start()
  await tick()
  closed.chat.close()
  decrypt.resolve(new TextEncoder().encode(JSON.stringify(inner('Stale'))).buffer)
  assert.equal(await loading, false)
  assert.deepEqual(closed.messages, [])
  assert.equal(closed.initialMessages, null)
})

function fileMetadata (mime = 'image/png') {
  const root = 'ab'.repeat(32)
  return { root, size: 1, mime, width: 1, height: 1, filename: 'one.png', service: 'irfs', url: `https://nostr.alt/${nfileEncode({ root, mime, filename: 'one.png' })}?localOnly=1` }
}

test('concurrent same-second attachments get distinct metadata, one catalog copy, and independent deletion', async t => {
  t.mock.method(Date, 'now', () => 2000000)
  const resolved = new Map()
  const f = fixture([], { verifyFile: async () => {}, onReference: (id, event) => resolved.set(id, event) })
  await f.chat.start()
  const first = f.chat.send('Same caption', null, { metadata: fileMetadata() })
  const second = f.chat.send('Same caption', first, { metadata: fileMetadata() })
  await Promise.all([f.chat.retry(first), f.chat.retry(second)])
  const files = f.writes.filter(write => write.event.kind === 1063 && write.options.context === `dm:${pubkey}`)
  const catalog = f.writes.filter(write => write.options.context === '')
  assert.equal(files.length, 2)
  assert.equal(catalog.length, 1, 'concurrent sends serialize the root check/write')
  assert.ok(files[1].event.created_at >= files[0].event.created_at)
  assert.deepEqual(f.messages.map(message => message.id), [first, second])
  const ids = files.map(({ event }) => getEventHash({ ...event, pubkey }))
  for (const { event } of files) assert.match(event.tags.find(tag => tag[0] === 'salt')[1], /^[A-Za-z0-9_-]{16}$/)
  assert.notEqual(ids[0], ids[1], 'the salt distinguishes identical files and captions within one second')
  assert.equal(f.chat.resolveReference(ids[1]).id, ids[1])
  assert.deepEqual(catalog[0].event, files[0].event, 'the catalog preserves the first metadata copy')
  assert.equal((await f.chat.readFiles()).length, 1)

  assert.equal(await f.chat.deleteMessage(second), true)
  const deletion = f.writes.at(-1)
  assert.equal(deletion.options.context, `dm:${pubkey}`)
  assert.deepEqual(deletion.event.tags, [['e', second], ['e', ids[1]], ['k', '9'], ['k', '1063']])
  assert.equal(f.chat.resolveReference(ids[1]), null, 'deleted metadata leaves the local resolver')
  assert.equal(resolved.get(ids[1]), null, 'rendered references are invalidated')
  assert.equal(f.messages[0].id, first, 'reply target survives')
  assert.equal((await f.eventStore.query({ '#c': [`dm:${pubkey}`], '#k': ['1063'] })).results.length, 1)
  assert.equal((await f.chat.readFiles()).length, 1)
  assert.equal(await f.chat.deleteMessage(first), true)
  assert.equal((await f.eventStore.query({ '#c': [`dm:${pubkey}`], '#k': ['1063'] })).results.length, 0)
  assert.equal((await f.chat.readFiles()).length, 1, 'deleting the matching inner ID in DM preserves its empty-context copy')
  assert.equal(f.messages.length, 0)

  t.mock.method(Date, 'now', () => 3000000)
  const reused = f.chat.send('New caption', null, { metadata: attachmentCatalog(await f.chat.readFiles())[0] })
  await f.chat.retry(reused)
  const reusedFile = f.writes.findLast(write => write.event.kind === 1063).event
  assert.equal(reusedFile.created_at, 3000)
  assert.equal(reusedFile.content, 'New caption')
  assert.ok(!ids.includes(getEventHash({ ...reusedFile, pubkey })))
  assert.equal(f.writes.filter(write => write.options.context === '').length, 1)
  f.chat.close()
})

test('catalog failures block message confirmation; retries keep events and do not duplicate a saved catalog entry', async () => {
  const f = fixture([], { verifyFile: async () => {} })
  await f.chat.start()
  const add = f.eventStore.addPersonalCopy
  let failCatalog = true
  let failMessage = true
  const attempts = []
  f.eventStore.addPersonalCopy = async (event, options) => {
    attempts.push({ event, options })
    if ((options.context === '' && failCatalog) || (event.kind === 9 && failMessage)) return { result: { ok: false, code: 'quota' } }
    return add(event, options)
  }
  const id = f.chat.send('Caption', null, { metadata: fileMetadata('video/mp4') })
  await f.chat.retry(id)
  assert.equal(f.messages[0].status, 'error')
  assert.equal(attempts.some(write => write.event.kind === 9), false)
  failCatalog = false
  await f.chat.retry(id)
  assert.equal(f.messages[0].status, 'error')
  assert.equal((await f.chat.readFiles()).length, 1)
  failMessage = false
  await f.chat.retry(id)
  assert.equal(f.messages[0].status, 'saved')
  const fileAttempts = attempts.filter(write => write.event.kind === 1063)
  assert.ok(fileAttempts.every(write => write.event === fileAttempts[0].event))
  assert.equal(f.writes.filter(write => write.options.context === '').length, 1)
  f.chat.close()
})

test('non-gallery attachments are deleted with their message, including after reloading', async () => {
  const f = fixture([], { verifyFile: async () => {} })
  await f.chat.start()
  const id = f.chat.send('', null, { metadata: fileMetadata('application/pdf') })
  await f.chat.retry(id)
  assert.equal(f.writes.length, 2)
  assert.equal((await f.chat.readFiles()).length, 0)
  const stored = f.writes.map(({ event, options }) => wrapper(event, options.context))
  f.chat.close()
  const reopened = fixture(stored)
  await reopened.chat.start()
  await reopened.chat.deleteMessage(id)
  assert.equal(reopened.writes[0].event.tags.filter(tag => tag[0] === 'e').length, 2)
  assert.equal((await reopened.eventStore.query({ '#k': ['1063'] })).results.length, 0)
  reopened.chat.close()
})

test('pasted file pointers are preserved and remote deletion cannot resurrect through a later emit', async () => {
  const f = fixture([], { verifyFile: async () => {} })
  await f.chat.start()
  const id = f.chat.send('', null, { metadata: fileMetadata() })
  await f.chat.retry(id)
  const fileMessage = f.messages[0]
  const pasted = f.chat.send(fileMessage.content)
  await f.chat.retry(pasted)
  await f.chat.deleteMessage(pasted)
  assert.deepEqual(f.writes.at(-1).event.tags, [['e', pasted], ['k', '9']])
  f.deliverDeletion(wrapper({ kind: 5, created_at: 100, content: '', tags: [['e', id], ['k', '9']] }))
  await tick()
  assert.equal(f.messages.length, 0)
  f.deliver(wrapper({ kind: 9, created_at: fileMessage.created_at, content: fileMessage.content, tags: fileMessage.tags }))
  await tick()
  const survivor = f.chat.send('Survivor')
  await f.chat.retry(survivor)
  assert.deepEqual(f.messages.map(message => message.id), [survivor])
  f.chat.close()
})

test('a confirmed remote deletion wins over a late local deletion failure', async () => {
  const f = fixture([wrapper(inner('Delete me'))])
  await f.chat.start()
  const id = f.messages[0].id
  const pending = Promise.withResolvers()
  f.eventStore.addPersonalCopy = () => pending.promise
  const deleting = f.chat.deleteMessage(id)
  await tick()
  f.deliverDeletion(wrapper({ kind: 5, created_at: 11, content: '', tags: [['e', id], ['k', '9']] }))
  await tick()
  pending.resolve({ result: { ok: false } })
  assert.equal(await deleting, false)
  assert.equal(f.messages.length, 0, 'the failed local attempt cannot undo another confirmed deletion')
  f.chat.close()
})

test('an unreadable matching catalog copy cannot be treated as absent on send', async () => {
  let locked = true
  const f = fixture([wrapper(createFileMetadata(fileMetadata()), '')], {
    verifyFile: async () => {},
    signer: {
      obfuscate: async value => value,
      nip44v3: { decrypt: async (owner, kind, scope, content) => { if (locked) throw new Error('LOCKED'); return base64ToBytes(content).buffer } }
    }
  })
  await f.chat.start()
  const id = f.chat.send('Caption', null, { metadata: fileMetadata() })
  await f.chat.retry(id)
  assert.equal(f.messages[0].status, 'error')
  assert.equal(f.writes.filter(write => write.options.context === '').length, 0)
  assert.equal(f.writes.some(write => write.event.kind === 9), false)
  locked = false
  await f.chat.retry(id)
  assert.equal(f.messages[0].status, 'saved')
  assert.equal(f.writes.filter(write => write.options.context === '').length, 0)
  assert.equal((await f.chat.readFiles()).length, 1)
  f.chat.close()
})

const saltedText = (text, at, byte) => ({ ...inner(text, at), tags: [['salt', bytesToBase64Url(new Uint8Array(12).fill(byte))]] })

test('salt search rejects an equal ID and accepts a lower ID within the same second', async t => {
  t.mock.method(Date, 'now', () => 2000000)
  t.mock.method(performance, 'now', () => 0)
  const candidates = Array.from({ length: 16 }, (_, byte) => {
    const event = saltedText('Same', 2000, byte)
    return { event, byte, id: getEventHash({ ...event, pubkey }) }
  }).sort((a, b) => a.id < b.id ? -1 : 1)
  const lower = candidates[0]
  const previous = candidates.at(-1)
  const f = fixture([wrapper(previous.event)])
  await f.chat.start()
  const bytes = [previous.byte, lower.byte]
  const random = t.mock.method(crypto, 'getRandomValues', value => value.fill(bytes.shift() ?? 0))
  const id = f.chat.send('Same')
  assert.equal(random.mock.callCount(), 2)
  random.mock.restore()
  assert.equal(id, lower.id)
  assert.deepEqual(f.messages.map(message => message.id), [previous.id, id])
  assert.ok(f.messages.every(message => message.created_at === 2000))
  await f.chat.retry(id)
  assert.equal(f.writes[0].event.created_at, 2000)
  assert.equal(getEventHash({ ...f.writes[0].event, pubkey }), id)
  f.chat.close()
})

test('the attempt cap advances logical seconds without waiting, including failures, deletions and clock rollback', async t => {
  let now = 2000000
  t.mock.method(Date, 'now', () => now)
  t.mock.method(performance, 'now', () => 0)
  const prior = saltedText('Same', 2000, 0)
  const f = fixture([wrapper(prior)])
  await f.chat.start()
  const random = t.mock.method(crypto, 'getRandomValues', value => value.fill(0))
  const first = f.chat.send('Same')
  assert.equal(random.mock.callCount(), 128, 'the search has a hard attempt cap even if the timer does not advance')
  const firstEvent = f.messages.find(message => message.id === first)
  assert.equal(firstEvent.created_at, 2001)
  const add = f.eventStore.addPersonalCopy
  f.eventStore.addPersonalCopy = async () => ({ result: { ok: false } })
  await f.chat.retry(first)
  assert.equal(f.messages.at(-1).status, 'error')
  const second = f.chat.send('Same')
  assert.equal(f.messages.at(-1).created_at, 2002, 'a failed future-dated send still sets the next ordering boundary')
  assert.deepEqual(f.messages.slice(-2).map(message => message.id), [first, second])
  f.eventStore.addPersonalCopy = add
  await f.chat.retry(second)
  await f.chat.retry(first)
  assert.deepEqual(f.messages.slice(-2).map(message => message.id), [first, second], 'late confirmation preserves creation order')
  assert.equal(f.writes.find(write => getEventHash({ ...write.event, pubkey }) === first).event.created_at, 2001)
  await f.chat.deleteMessage(second)
  now = 1000000
  const third = f.chat.send('Same')
  assert.equal(f.messages.at(-1).id, third)
  assert.equal(f.messages.at(-1).created_at, 2003, 'neither deletion nor a backwards wall clock resets the cursor')
  random.mock.restore()
  await f.chat.retry(third)
  f.chat.close()
})

test('elapsed-time exhaustion rebuilds the attachment and pointers before acceptance and retry', async t => {
  t.mock.method(Date, 'now', () => 2000000)
  t.mock.method(crypto, 'getRandomValues', value => value.fill(0))
  const f = fixture([], { verifyFile: async () => {} })
  await f.chat.start()
  const first = f.chat.send('Same caption', null, { metadata: fileMetadata() })
  await f.chat.retry(first)
  const originalFile = f.writes.find(write => write.event.kind === 1063).event
  const originalFileId = getEventHash({ ...originalFile, pubkey })
  let time = 0
  t.mock.method(performance, 'now', () => { time += 5; return time })
  const id = f.chat.send('Same caption', null, { metadata: fileMetadata() })
  assert.equal(time, 10, 'the elapsed-time limit stops the search before another salt attempt')
  const pending = f.messages.at(-1)
  assert.equal(pending.created_at, 2001)
  const [pointer] = parseChatContent(pending.content)
  const fileId = pending.tags.find(tag => tag[0] === 'q')[1]
  assert.notEqual(fileId, originalFileId)
  assert.equal(pointer.event.id, fileId)
  const file = f.chat.resolveReference(fileId)
  assert.equal(file.created_at, pending.created_at)
  assert.equal(getEventHash(file), fileId)
  assert.equal(getEventHash(pending), id)

  const add = f.eventStore.addPersonalCopy
  f.eventStore.addPersonalCopy = async () => ({ result: { ok: false } })
  await f.chat.retry(id)
  f.eventStore.addPersonalCopy = add
  await f.chat.retry(id)
  assert.equal(f.messages.at(-1).id, id)
  assert.equal(f.writes.at(-1).event.created_at, 2001)
  assert.equal(getEventHash({ ...f.writes.at(-1).event, pubkey }), id)
  assert.equal(f.writes.findLast(write => write.event.kind === 1063).event.created_at, 2001)
  assert.equal(f.writes.filter(write => write.options.context === '').length, 1)
  f.chat.close()
})

test('history and live events seed the newest boundary regardless of arrival order, including after reload', async t => {
  t.mock.method(Date, 'now', () => 2000000)
  t.mock.method(performance, 'now', () => 0)
  const events = [saltedText('Same', 2000, 0), saltedText('Same', 2000, 1)]
    .map(event => ({ event, id: getEventHash({ ...event, pubkey }) }))
    .sort((a, b) => a.id < b.id ? -1 : 1)
  const f = fixture(events.map(({ event }) => wrapper(event)))
  await f.chat.start()
  assert.deepEqual(f.messages.map(message => message.id), events.map(event => event.id).reverse(), 'timestamp ties render highest IDs first')
  const byte = events[0].event.tags[0][1] === saltedText('Same', 2000, 0).tags[0][1] ? 0 : 1
  const random = t.mock.method(crypto, 'getRandomValues', value => value.fill(byte))
  const id = f.chat.send('Same')
  assert.equal(f.messages.at(-1).created_at, 2001, 'the last-arriving older event cannot replace the boundary')
  random.mock.restore()
  await f.chat.retry(id)
  f.deliver(wrapper(inner('Live newer', 2005)))
  await tick()
  const later = f.chat.send('After live history')
  await f.chat.retry(later)
  assert.equal(f.messages.at(-1).id, later)
  assert.ok(f.messages.at(-1).created_at >= 2005)
  const saved = f.writes.filter(write => write.event.kind === 9)
  f.chat.close()
  const reopened = fixture(saved.toReversed().map(({ event }) => wrapper(event)))
  await reopened.chat.start()
  assert.deepEqual(reopened.messages.map(message => message.id), [id, later])
  const afterReload = reopened.chat.send('After reload')
  await reopened.chat.retry(afterReload)
  assert.equal(reopened.messages.at(-1).id, afterReload)
  assert.ok(reopened.messages.at(-1).created_at >= saved.at(-1).event.created_at)
  reopened.chat.close()
})

test('malformed decrypted JSON is skipped without failing initial history', async () => {
  const valid = wrapper(inner('Valid note'))
  const broken = ['not json', 'null'].map(content => finalizeEvent({ ...valid, content: bytesToBase64(new TextEncoder().encode(content)) }, secret))
  const f = fixture([...broken, valid])
  try {
    assert.equal(await f.chat.start(), true)
    assert.deepEqual(f.messages.map(event => event.content), ['Valid note'])
    assert.deepEqual(f.errors, [])
  } finally { f.chat.close() }
})
