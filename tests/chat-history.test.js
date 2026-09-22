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
  let running = 0; let maxRunning = 0; let state; let fail = false
  let wake
  const live = []
  const select = f => events.filter(e => (!f.ids || f.ids.includes(e.id)) && (f.until === undefined || e.created_at <= f.until) && !f['!ids']?.includes(e.id)).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, f.limit)
  const eventStore = {
    subscribe (f, opts) {
      assert.equal(opts.initial, true); assert.equal(f.limit, 50)
      const queue = [...select(f).map(event => ({ type: 'event', event })), { type: 'eose' }]
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
    async accept (event, active) { running++; maxRunning = Math.max(maxRunning, running); await tick(); running--; if (options.reject?.(event)) throw new Error('decrypt'); if (active()) accepted.push(event.id); return event.id },
    onBatch () {}, onState (value) { state = value }, onMissing () {}, onError: assert.fail
  })
  return {
    history, eventStore, accepted, queries, retained, get state () { return state }, get maxRunning () { return maxRunning }, get fail () { return fail }, set fail (value) { fail = value },
    add (e, notify = true) { events.push(e); if (!notify) return; const item = { value: { type: 'event', event: e }, done: false }; if (wake) { const resolve = wake; wake = null; resolve(item) } else live.push(item) }
  }
}
test('50-item opening, four workers, inclusive pages across 235 equal timestamps, singleflight and failures', async () => {
  const f = fixture(235)
  try {
    await f.history.start()
    assert.equal(f.accepted.length, 50); assert.equal(f.queries.length, 0); assert.equal(f.maxRunning, 4)
    f.fail = true
    assert.equal(await f.history.loadOlder(), false); assert.equal(f.accepted.length, 50); assert.equal(f.state.error, 'offline')
    f.fail = false
    const first = f.history.loadOlder(); assert.equal(f.history.loadOlder(), first); await first
    while (f.state.hasOlder) await f.history.loadOlder()
    assert.equal(new Set(f.accepted).size, 235); assert.equal(f.accepted.length, 235)
    assert.ok(f.queries.every(q => q.until === 100 && q.limit === 50))
    f.add(wrapper(500, 50)); await tick(); assert.equal(f.accepted.length, 235); assert.equal(f.state.hasOlder, true)
    await f.history.loadOlder(); assert.equal(f.accepted.length, 236)
    f.add(wrapper(600, 101)); await tick(); await tick(); assert.equal(f.accepted.length, 237)
  } finally { f.history.close() }
})
test('failed decryption can retry the same page; close ignores queued work', async () => {
  let reject = true
  const f = fixture(70, { reject: event => reject && event.id === wrapper(55).id })
  await f.history.start()
  assert.equal(await f.history.loadOlder(), false)
  reject = false
  assert.equal(await f.history.loadOlder(), true)
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
    assert.equal(f.retained.size, 170)
    while (state.hasOlder) await recovered.loadOlder()
    assert.equal(f.retained.size, 200)
    assert.equal(f.accepted.length, 200, 'retained wrappers are not decrypted again')
    assert.ok(f.queries.filter(query => query.ids).every(query => query.ids.length <= 50))
  } finally { recovered.close() }
})
