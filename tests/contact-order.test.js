import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createContactOrder, orderHomeContacts } from '#services/contact-order.js'

const flush = async () => { for (let n = 0; n < 3; n++) await new Promise(resolve => setImmediate(resolve)) }
const contact = (pubkey, extra = {}) => ({ pubkey, ...extra })
function fixture (t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const ready = new Map(['a', 'b', 'c', 'd'].map(id => [id, Promise.withResolvers()]))
  const changes = []
  const order = createContactOrder({ initialReady: id => ready.get(id).promise, onChange: state => changes.push(state) })
  t.after(() => order.close())
  return { order, ready, changes, latest: () => changes.at(-1), advance: async ms => { t.mock.timers.tick(ms); await flush() } }
}

test('profiles update presentation while arrival order stays stable until the entire cohort settles', async t => {
  const f = fixture(t)
  f.order.reconcile([contact('b'), contact('a'), contact('c', { pinned: true })])
  const people = [{ id: 'b', name: 'Zulu' }, { id: 'a', name: 'Aaron' }, { id: 'c', name: 'Pinned', pinned: true }, { id: 'user', name: 'Mona' }]
  f.ready.get('a').resolve({ name: 'Aaron' }); f.ready.get('c').resolve({})
  await flush()
  assert.deepEqual(orderHomeContacts(people, f.latest()).map(person => person.id), ['c', 'b', 'a', 'user'])
  assert.equal(f.latest().alphabetical, false)
  f.ready.get('b').resolve(null)
  await flush()
  assert.deepEqual(orderHomeContacts(people, f.latest()).map(person => person.id), ['c', 'a', 'user', 'b'])
  people[0].name = 'Aardvark'
  assert.deepEqual(orderHomeContacts(people, f.latest()).map(person => person.id), ['c', 'b', 'a', 'user'])
})

test('a cached cohort sorts immediately and never waits for remote refresh', async t => {
  const f = fixture(t)
  f.ready.get('a').resolve({}); f.ready.get('b').resolve({ name: 'Cached' })
  f.order.reconcile([contact('b'), contact('a')])
  await flush()
  assert.equal(f.latest().alphabetical, true)
})

test('the thirty-second cap is absolute across membership changes and retries', async t => {
  const f = fixture(t)
  f.order.reconcile([])
  await f.advance(60000)
  f.order.reconcile([contact('a'), contact('b')])
  await f.advance(20000)
  f.order.reconcile([contact('b'), contact('a'), contact('c')])
  assert.deepEqual(f.latest().ids, ['a', 'b', 'c'])
  await f.advance(9999)
  assert.equal(f.latest().alphabetical, false)
  await f.advance(1)
  assert.equal(f.latest().alphabetical, true)
  f.order.reconcile([contact('a'), contact('d')])
  assert.equal(f.latest().alphabetical, true)
})

test('removals and petnames release the cohort; additions do not extend it', async t => {
  const f = fixture(t)
  f.order.reconcile([contact('a'), contact('b')])
  f.order.reconcile([contact('a'), contact('b'), contact('c')])
  f.ready.get('a').resolve(null); await flush()
  assert.equal(f.latest().alphabetical, false)
  f.order.reconcile([contact('b', { petname: 'Local alias' }), contact('c')])
  assert.equal(f.latest().alphabetical, true)
  assert.deepEqual(f.latest().ids, ['b', 'c'])
})

test('local list readiness starts the deadline and rejected profiles never block sorting', async t => {
  const f = fixture(t)
  f.order.reconcile([contact('a')], { start: false })
  await f.advance(60000)
  assert.equal(f.latest().alphabetical, false)
  f.order.reconcile([contact('a')])
  f.ready.get('a').reject(new Error('failed lookup'))
  await flush()
  assert.equal(f.latest().alphabetical, true)
})

test('closing a generation clears its timer and ignores old readiness responses', async t => {
  const f = fixture(t)
  f.order.reconcile([contact('a')])
  const count = f.changes.length
  f.order.close()
  f.ready.get('a').resolve({ name: 'Old account' })
  await f.advance(30000)
  f.order.reconcile([contact('b')])
  assert.equal(f.changes.length, count)
})
