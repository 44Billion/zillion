import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, getEventHash } from 'libp2r2p/event'
import { bytesToBase64, base64ToBytes } from 'libp2r2p/base64'
import { createSelfChat } from '#services/self-chat.js'
import { parseChatContent } from '#helpers/chat-content.js'

const secret = new Uint8Array(32).fill(1)
const pubkey = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '' }, secret).pubkey
const inner = (text, at = 10) => ({ kind: 9, created_at: at, content: text, tags: [] })
function wrapper (event, context = `dm:${pubkey}`, provenance = '1') {
  return finalizeEvent({ kind: 1006, created_at: event.created_at, tags: [['k', String(event.kind)], ['c', context], ['v', provenance]], content: bytesToBase64(new TextEncoder().encode(JSON.stringify(event))) }, secret)
}
function fixture (history = []) {
  let deliver
  let returned = false
  const writes = []
  const errors = []
  let messages = []
  let initialMessages = null
  const subscription = {
    [Symbol.asyncIterator] () { return this },
    next: () => new Promise(resolve => { deliver = resolve }),
    return: async () => { returned = true; deliver?.({ done: true }); return { done: true } }
  }
  const eventStore = {
    subscribe (filter, options) {
      assert.deepEqual(options, { initial: true })
      assert.deepEqual(filter, { kinds: [1006], authors: [pubkey], '#k': ['9'], '#c': [`dm:${pubkey}`], '#v': ['0', '1'] })
      return subscription
    },
    query: async () => ({ results: history }),
    addPersonalCopy: async (event, options) => { writes.push({ event, options }); return { result: { ok: true, stored: true } } }
  }
  const chat = createSelfChat({ pubkey, eventStore, signer: { obfuscate: async value => value, nip44v3: { decrypt: async (owner, kind, scope, content) => base64ToBytes(content).buffer } }, onMessages: value => { messages = value }, onError: error => errors.push(error), onInitialLoad: () => { initialMessages = messages } })
  return { chat, writes, errors, eventStore, get initialMessages () { return initialMessages }, get messages () { return messages }, get returned () { return returned }, deliver: event => deliver({ done: false, value: { result: event } }) }
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
  assert.deepEqual(f.messages.map(event => event.content), ['Earlier note', 'Private note'])
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
  assert.equal(f.writes[0].event.sig, undefined)
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
