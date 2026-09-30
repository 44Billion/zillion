import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChatHistory } from '../src/services/chat-history.js'
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
const wrapper = (id, at = 100) => ({ id: String(id).padStart(64, '0'), created_at: at })
function fixture (count, options = {}) {
  const events = Array.from({ length: count }, (_, i) => wrapper(i))
  const retained = new Map()
  const accepted = []
  const queries = []
  const batches = []
  let running = 0; let maxRunning = 0; let state; let fail = false
  let wake
  const live = []
  const select = f => events.filter(e => (!f.ids || f.ids.includes(e.id)) && (f.until === undefined || e.created_at <= f.until) && !f['!ids']?.includes(e.id)).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, f.limit)
  const eventStore = {
    subscribe (f, opts) {
      assert.equal(opts.initial, true); assert.equal(f.limit, 25)
      const queue = options.manual ? [] : [...select(f).map(event => ({ type: 'event', event })), { type: 'eose' }]
      return {
        [Symbol.asyncIterator] () { return this },
        next: () => queue.length ? Promise.resolve({ value: queue.shift(), done: false }) : live.length ? Promise.resolve(live.shift()) : new Promise(resolve => { wake = resolve }),
        return: async () => { wake?.({ done: true }); return { done: true } }
      }
    },
    async query (f) { queries.push(f); if (fail) throw new Error('offline'); const results = select(f); return { results: f.ids_only ? results.map(e => e.id) : results } }
  }
  const history = createChatHistory({
    eventStore, filter: { kinds: [1006], '#c': ['private'] }, retained,
    async accept (event, active) { running++; maxRunning = Math.max(maxRunning, running); await options.wait?.(event); await tick(); running--; if (options.reject?.(event)) throw new Error('decrypt'); if (active()) accepted.push(event.id); return event.id },
    onBatch () { batches.push([...accepted]) }, onState (value) { state = value }, onMissing () {}, onError: assert.fail
  })
  return {
    history, eventStore, accepted, queries, retained, batches, get state () { return state }, get maxRunning () { return maxRunning }, get fail () { return fail }, set fail (value) { fail = value },
    deliver (value) { const item = { value, done: false }; if (wake) { const resolve = wake; wake = null; resolve(item) } else live.push(item) },
    add (e, notify = true) { events.push(e); if (!notify) return; const item = { value: { type: 'event', event: e }, done: false }; if (wake) { const resolve = wake; wake = null; resolve(item) } else live.push(item) }
  }
}
test('25-item opening, four workers, inclusive pages across 235 equal timestamps, singleflight and failures', async () => {
  const f = fixture(235)
  try {
    await f.history.start()
    assert.equal(f.accepted.length, 25); assert.equal(f.queries.length, 0); assert.equal(f.maxRunning, 4)
    f.fail = true
    assert.equal(await f.history.loadOlder(), false); assert.equal(f.accepted.length, 25); assert.equal(f.state.error, 'offline')
    f.fail = false
    const first = f.history.loadOlder(); assert.equal(f.history.loadOlder(), first); await first
    while (f.state.hasOlder) await f.history.loadOlder()
    assert.equal(new Set(f.accepted).size, 235); assert.equal(f.accepted.length, 235)
    assert.ok(f.queries.every(q => q.until === 100 && q.limit === 25))
    f.add(wrapper(500, 50)); await tick(); assert.equal(f.accepted.length, 235); assert.equal(f.state.hasOlder, true)
    await f.history.loadOlder(); assert.equal(f.accepted.length, 236)
    f.add(wrapper(600, 101)); await tick(); await tick(); assert.equal(f.accepted.length, 237)
  } finally { f.history.close() }
})
test('failed decryption can retry the same page; close ignores queued work', async () => {
  let reject = true
  const f = fixture(70, { reject: event => reject && event.id === wrapper(30).id })
  await f.history.start()
  assert.equal(await f.history.loadOlder(), false)
  reject = false
  assert.equal(await f.history.loadOlder(), true)
  while (f.state.hasOlder) await f.history.loadOlder()
  assert.equal(new Set(f.accepted).size, 70)
  f.add(wrapper(800, 200)); f.history.close(); await tick(); await tick()
  assert.equal(new Set(f.accepted).size, 70)
})

test('recovery retains visited pages but does not skip a gap larger than its recent snapshot', async () => {
  const f = fixture(120)
  await f.history.start()
  while (f.state.hasOlder) await f.history.loadOlder()
  f.history.close()
  for (let i = 0; i < 80; i++) f.add(wrapper(1000 + i, 200 + i), false)
  let state
  const recovered = createChatHistory({
    eventStore: f.eventStore, filter: {}, retained: f.retained,
    accept: async event => { f.accepted.push(event.id); return event.id },
    onMissing: assert.fail, onError: assert.fail, onBatch () {}, onState (value) { state = value }
  })
  try {
    await recovered.start()
    assert.equal(f.retained.size, 145)
    while (state.hasOlder) await recovered.loadOlder()
    assert.equal(f.retained.size, 200)
    assert.equal(f.accepted.length, 200, 'retained wrappers are not decrypted again')
    assert.ok(f.queries.filter(query => query.ids).every(query => query.ids.length <= 25))
  } finally { recovered.close() }
})

const until = async predicate => { for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await tick() }; assert.fail('condition not reached') }

test('initial messages appear before EOSE and before slower decryptions, with bounded concurrency and deduplication', async t => {
  const held = Promise.withResolvers()
  const f = fixture(0, { manual: true, wait: event => event.id === wrapper(0).id ? held.promise : undefined })
  t.after(() => { f.history.close(); held.resolve() })
  let ready = false
  const opening = f.history.start().then(value => { ready = true; return value })
  for (let i = 0; i < 8; i++) f.deliver({ type: 'event', event: wrapper(i) })
  f.deliver({ type: 'event', event: wrapper(1) })
  await until(() => f.batches.some(batch => batch.length === 7))
  assert.equal(ready, false, 'no EOSE yet')
  assert.ok(!f.accepted.includes(wrapper(0).id), 'a slow message does not block the others')
  assert.equal(f.maxRunning, 4)
  f.deliver({ type: 'eose' })
  await tick()
  assert.equal(ready, false, 'EOSE alone does not finish pending decryptions')
  held.resolve()
  assert.equal(await opening, true)
  assert.equal(f.accepted.length, 8)
  assert.equal(new Set(f.accepted).size, 8)
  assert.equal(f.batches.at(-1).length, 8)
  assert.equal(f.state.hasOlder, false)
})

test('initial decryption failures surface before EOSE instead of hanging readiness', async t => {
  const f = fixture(0, { manual: true, reject: () => true })
  t.after(() => f.history.close())
  const opening = assert.rejects(f.history.start(), /decrypt/)
  f.deliver({ type: 'event', event: wrapper(1) })
  await opening
  assert.deepEqual(f.batches, [])
})

test('closing before EOSE settles readiness and prevents pending or queued work from updating the UI', async () => {
  const held = Promise.withResolvers()
  const f = fixture(0, { manual: true, wait: () => held.promise })
  const opening = f.history.start()
  for (let i = 0; i < 8; i++) f.deliver({ type: 'event', event: wrapper(i) })
  await until(() => f.maxRunning === 4)
  f.history.close()
  assert.equal(await opening, false)
  held.resolve()
  await tick(); await tick()
  assert.deepEqual(f.accepted, [])
  assert.deepEqual(f.batches, [])
})

test('older pages also publish partial results and preserve their cursor when a decryption fails', async t => {
  const held = Promise.withResolvers()
  let reject = true
  const f = fixture(51, { wait: event => event.id === wrapper(25).id ? held.promise : undefined, reject: event => reject && event.id === wrapper(25).id })
  t.after(() => { f.history.close(); held.resolve() })
  await f.history.start()
  const loading = f.history.loadOlder()
  await until(() => f.batches.some(batch => batch.length === 49))
  assert.equal(f.state.loading, true)
  held.resolve()
  assert.equal(await loading, false)
  assert.equal(f.state.error, 'decrypt')
  reject = false
  assert.equal(await f.history.loadOlder(), true)
  assert.deepEqual(f.queries[1], f.queries[0], 'retry reads the same page')
  assert.equal(f.accepted.length, 50)
  assert.equal(new Set(f.accepted).size, 50)
})

test('shared workers promote queued foreground work without increasing concurrency', async () => {
  const { createChatWorkers } = await import('../src/services/chat-history.js')
  const workers = createChatWorkers(2)
  const gate = Promise.withResolvers()
  const calls = []
  const first = workers(() => gate.promise)
  const second = workers(() => gate.promise)
  let foreground = 'a'
  const background = workers(() => calls.push('b'), () => foreground === 'b' ? 1 : 0)
  const promoted = workers(() => calls.push('c'), () => foreground === 'c' ? 1 : 0)
  foreground = 'c'
  assert.deepEqual(calls, [])
  gate.resolve()
  await Promise.all([first, second, background, promoted])
  assert.deepEqual(calls, ['c', 'b'])
})
