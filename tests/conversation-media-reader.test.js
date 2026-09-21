import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, getEventHash } from 'libp2r2p/event'
import { createConversationMediaReader } from '../src/services/conversation-media.js'
import { VIEWER_MIMES, compareMedia } from '../src/helpers/viewer-media.js'

const secret = new Uint8Array(32).fill(7)
const pubkey = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '' }, secret).pubkey
const context = `dm:${pubkey}`
const mirror = (value, kind, scope) => `${scope}:${value}`
function fixture () {
  const events = new Map()
  const subscriptions = []
  const queries = []
  const counts = []
  let decryptions = 0
  const matches = (event, f) => (!f.ids || f.ids.includes(event.id)) && !f['!ids']?.includes(event.id) &&
    (!f.kinds || f.kinds.includes(event.kind)) && (!f.authors || f.authors.includes(event.pubkey)) &&
    (f.since == null || event.created_at >= f.since) && (f.until == null || event.created_at <= f.until) &&
    Object.entries(f).every(([key, values]) => (key[0] !== '#' && key[0] !== '&') || (key[0] === '#' ? values.some(value => event.tags.some(tag => tag[0] === key.slice(1) && tag[1] === value)) : values.every(value => event.tags.some(tag => tag[0] === key.slice(1) && tag[1] === value))))
  const eventStore = {
    async query (filter) {
      queries.push(filter)
      const asc = filter.search === 'sort:asc'
      const selected = [...events.values()].filter(event => matches(event, filter)).sort((a, b) => (asc ? 1 : -1) * (a.created_at - b.created_at) || a.id.localeCompare(b.id)).slice(0, filter.limit ?? 200)
      return { results: filter.ids_only ? selected.map(event => event.id) : selected }
    },
    async count (filter) { counts.push(filter); return [...events.values()].filter(event => matches(event, filter)).length },
    subscribe (filter) {
      let finish
      const messages = []
      const stream = {
        filter, closed: false,
        [Symbol.asyncIterator] () { return this },
        next () { return messages.length ? Promise.resolve({ value: messages.shift(), done: false }) : new Promise(resolve => { finish = resolve }) },
        async return () { this.closed = true; finish?.({ done: true }) },
        send (event) { if (this.closed || !matches(event, filter)) return; const value = { result: event }; if (finish) { const resolve = finish; finish = null; resolve({ value, done: false }) } else messages.push(value) }
      }
      subscriptions.push(stream)
      return stream
    }
  }
  const signer = { obfuscate: async (...args) => mirror(...args), nip44v3: { decrypt: async (owner, kind, scope, content) => { decryptions++; return new TextEncoder().encode(content).buffer } } }
  const add = (n, { at = n + 10, mime = 'image/jpeg', ctx = context, kind = 1063, tags = [] } = {}) => {
    const inner = { kind, created_at: at, tags: [['m', mime], ['url', `https://example.com/${n}.jpg`], ['salt', String(n)], ...tags], content: `File ${n}` }
    const id = getEventHash({ ...inner, pubkey })
    const wrapper = finalizeEvent({ kind: 1006, created_at: at, tags: [['k', String(kind)], ['c', mirror(ctx, '1006', '')], ['v', '1'], ['o', mirror(id, '1006', '.id')], ...inner.tags.filter(tag => tag[0].length === 1).map(tag => ['o', mirror(tag[1], '1006', `#${tag[0]}`)])], content: JSON.stringify(inner) }, secret)
    events.set(wrapper.id, wrapper)
    for (const stream of subscriptions) stream.send(wrapper)
    return { id: `file:${id}`, wrapperId: wrapper.id, orderId: wrapper.id, created_at: at }
  }
  return { add, events, subscriptions, queries, counts, eventStore, signer, get decryptions () { return decryptions }, reader: options => createConversationMediaReader({ pubkey, eventStore, signer, ...options }) }
}

test('file count and pages use the same context/MIME filter, include orphans/download, and decrypt a bounded page', async () => {
  const f = fixture()
  const files = Array.from({ length: 30 }, (_, n) => f.add(n, { tags: n === 15 ? [['download', '1']] : [] }))
  f.add(31, { ctx: '' }); f.add(32, { ctx: 'dm:other' }); f.add(33, { mime: 'application/pdf' }); f.add(34, { kind: 9 })
  const reader = f.reader()
  const state = await reader.open(files[15].id)
  assert.equal(state.total, 30)
  assert.equal(state.index, 15)
  assert.equal(state.current.download, '1')
  assert.equal(state.previous.id, files[14].id)
  assert.equal(state.next.id, files[16].id)
  assert.ok(f.decryptions <= 7)
  assert.ok(f.counts.every(filter => !('limit' in filter) && filter['#o'].length === VIEWER_MIMES.length))
  assert.ok(f.queries.every(filter => filter.ids_only || filter.limit <= 3))
  const after = await reader.move(1)
  assert.equal(after.index, 16)
  assert.equal(f.counts.length, 2, 'moving increments the ordinal without recounting')
  reader.close()
  assert.ok(f.subscriptions.every(stream => stream.closed))
  await assert.rejects(reader.move(1), { name: 'AbortError' })
})

test('more than 200 same-second files can be traversed in both directions without omissions or duplicates', async () => {
  const f = fixture()
  const files = Array.from({ length: 213 }, (_, n) => f.add(n, { at: 50 })).sort(compareMedia)
  const reader = f.reader()
  let state = await reader.open(files[100].id)
  assert.equal(state.index, 100)
  for (let index = 101; index < files.length; index++) {
    state = await reader.move(1)
    assert.equal(state.current.id, files[index].id)
    assert.equal(state.index, index)
  }
  assert.equal(state.next, null)
  for (let index = files.length - 2; index >= 0; index--) {
    state = await reader.move(-1)
    assert.equal(state.current.id, files[index].id)
  }
  assert.equal(state.previous, null)
  assert.ok(f.queries.some(filter => filter.ids_only && filter['!ids']?.length === 200))
  reader.close()
})

test('loaded URL descriptors interleave with files, remain a snapshot, and missing routes do not scan messages', async () => {
  const f = fixture()
  const first = f.add(0, { at: 10 }); const last = f.add(1, { at: 30 })
  const extras = [{ id: 'message:0', messageId: 'message', url: 'https://example.com/url.jpg', created_at: 20, orderId: 'message', type: 'image' }]
  const reader = f.reader({ extras })
  extras.length = 0
  let state = await reader.open('message:0')
  assert.equal(state.total, 3)
  assert.equal(state.index, 1)
  assert.equal(state.previous.id, first.id); assert.equal(state.next.id, last.id)
  state = await reader.open('absent:0')
  assert.equal(state.current, null)
  assert.equal(state.total, 3)
  reader.close()
})

test('live deletion advances, falls back to the previous item, removes URL occurrences and reaches empty', async () => {
  const f = fixture()
  const first = f.add(0); const middle = f.add(1); const last = f.add(2)
  let invalidations = 0
  const reader = f.reader({ onInvalidate: () => invalidations++ })
  await reader.open(middle.id)
  f.events.delete(middle.wrapperId)
  f.add(100, { kind: 5, tags: [['e', middle.id.slice(5)]] })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(invalidations > 0)
  let state = await reader.refresh()
  assert.equal(state.current.id, last.id); assert.equal(state.total, 2)
  f.events.delete(last.wrapperId)
  state = await reader.refresh()
  assert.equal(state.current.id, first.id)
  f.events.delete(first.wrapperId)
  state = await reader.refresh()
  assert.equal(state.current, null); assert.equal(state.total, 0)
  reader.close()
})

test('an admitted but unreadable file keeps its counted slot; retry and session close release pending work', async () => {
  const f = fixture()
  const file = f.add(0)
  const wrapper = f.events.get(file.wrapperId)
  f.events.set(file.wrapperId, { ...wrapper, content: 'broken ciphertext' })
  const reader = f.reader()
  const state = await reader.open(file.id)
  assert.equal(state.total, 1)
  assert.equal(state.current.unavailable, true)
  assert.equal(state.current.url, undefined)
  f.events.set(file.wrapperId, wrapper)
  const recovered = await reader.open(file.id)
  // A refresh invalidates negative metadata as well as successful descriptors.
  assert.equal((await reader.refresh()).current.unavailable, false)
  assert.equal(recovered.total, 1)
  reader.close()
})

test('URL deletion is driven by an admitted envelope, while additions refresh count without changing selection', async () => {
  const f = fixture()
  const first = f.add(0, { at: 10 })
  const extras = [{ id: 'message:0', messageId: 'message', url: 'https://example.com/url.jpg', created_at: 20, orderId: 'message', type: 'image' }]
  const reader = f.reader({ extras })
  await reader.open(extras[0].id)
  const next = f.add(1, { at: 30 })
  await new Promise(resolve => setTimeout(resolve, 40))
  let state = await reader.refresh()
  assert.equal(state.current.id, extras[0].id)
  assert.equal(state.total, 3)
  f.add(2, { kind: 5, tags: [['e', 'message']] })
  await new Promise(resolve => setTimeout(resolve, 40))
  state = await reader.refresh()
  assert.equal(state.current.id, next.id)
  assert.equal(state.previous.id, first.id)
  assert.equal(state.total, 2)
  reader.close()
})

test('closing an in-flight session prevents late query results from being applied', async () => {
  const f = fixture()
  const file = f.add(0)
  const query = f.eventStore.query
  let release
  const started = new Promise(resolve => {
    f.eventStore.query = async filter => {
      resolve()
      await new Promise(resolve => { release = resolve })
      return query(filter)
    }
  })
  const reader = f.reader()
  const opening = reader.open(file.id)
  await started
  reader.close()
  release()
  await assert.rejects(opening, { name: 'AbortError' })
  assert.ok(f.subscriptions.every(stream => stream.closed))
})

test('an empty session discovers a new file, while an explicit unavailable URL stays unavailable', async () => {
  const f = fixture()
  const reader = f.reader()
  assert.equal((await reader.open()).total, 0)
  const file = f.add(0)
  assert.equal((await reader.refresh()).current.id, file.id)
  await reader.open('unloaded-message:0')
  assert.equal((await reader.refresh()).current, null)
  reader.close()
})
