import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, getEventHash } from 'libp2r2p/event'
import { bytesToBase64, base64ToBytes } from 'libp2r2p/base64'
import { nfileEncode } from 'libp2r2p/nip19'
import { createFileMetadata, decodeFileMetadata } from 'libp2r2p/nip94'
import { chatReferenceUri } from '#services/chat-references.js'
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

function fixture (t, initial = []) {
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
    async query (filter) { queries.push(filter); return { results: select(filter) } },
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
  const summaries = createConversationSummaries({
    pubkey: owner, eventStore, signer: { obfuscate: async value => value, nip44v3: { decrypt: (...args) => decrypt(...args) } },
    onChange: (peer, record) => { updates.push({ peer, record }); if (record) records.set(peer, record); else records.delete(peer) },
    onError: error => errors.push(error)
  })
  t.after(() => summaries.close())
  const add = event => { events.set(event.id, event); for (const stream of streams) if (matches(event, stream.filter)) stream.push(event) }
  return { summaries, records, queries, subscriptions, decrypted, updates, errors, events, streams, add, decrypt: value => { decrypt = value } }
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
  assert.ok(!f.updates.some(update => update.record?.event?.id === getEventHash(original)), 'stale work never becomes a visible preview')
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
