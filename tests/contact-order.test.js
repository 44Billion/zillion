import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createContactOrder, orderHomeContacts, INITIAL_CONTACT_CACHE_TIMEOUT_MS } from '#services/contact-order.js'

const flush = async () => { for (let n = 0; n < 3; n++) await new Promise(resolve => setImmediate(resolve)) }
function mobileViewport (t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  let mobile = true
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: query => {
      assert.equal(query, '(max-width: 718px)')
      return { matches: mobile }
    }
  })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'matchMedia', original); else delete globalThis.matchMedia })
  return () => { mobile = false }
}
const contact = (pubkey, extra = {}) => ({ pubkey, ...extra })
function fixture (t, options = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const ready = new Map(['a', 'b', 'c', 'd'].map(id => [id, Promise.withResolvers()]))
  const changes = []
  const order = createContactOrder({ initialReady: id => ready.get(id).promise, onChange: state => changes.push(state), ...options })
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

function cachedFixture (t) {
  const local = new Map(['a', 'b', 'c', 'd', 'owner'].map(id => [id, Promise.withResolvers()]))
  const people = [
    { id: 'b', name: 'Zulu', pinned: true }, { id: 'a', name: 'Aaron', pinned: true },
    { id: 'c', name: 'npub1missing…' }, { id: 'd', name: 'Diana' }, { id: 'user', name: 'Mona', self: true }
  ]
  const f = fixture(t, {
    self: { id: 'user', pubkey: 'owner' },
    localReady: id => local.get(id).promise,
    nameFor: (id, profile, contact) => contact?.petname || profile?.name || people.find(person => person.id === (id === 'owner' ? 'user' : id)).name
  })
  return { ...f, local, people, visible: () => orderHomeContacts(people.filter(person => f.latest().ids.includes(person.id)), f.latest()).map(person => person.id) }
}

test('a partial cache seeds the first peer paint, including self, and remote names cannot move it', async t => {
  const f = cachedFixture(t)
  f.order.reconcile([contact('b', { pinned: true }), contact('a', { pinned: true }), contact('c')])
  assert.equal(f.latest().localPending, true)
  assert.deepEqual(f.visible(), ['user'])
  f.local.get('b').resolve({ name: 'Zulu' }); f.local.get('a').resolve({ name: 'Aaron' })
  f.local.get('c').resolve(null); f.local.get('owner').resolve({ name: 'Mona' })
  f.ready.get('b').resolve({}); f.ready.get('a').resolve({})
  await flush()
  assert.equal(f.latest().localPending, false)
  assert.equal(f.latest().alphabetical, false, 'one uncached peer must not hold the cached seed')
  assert.deepEqual(f.latest().ids, ['a', 'user', 'c', 'b'])
  assert.deepEqual(f.visible(), ['a', 'b', 'user', 'c'])
  f.people.find(person => person.id === 'b').name = 'Aardvark'
  f.people.find(person => person.id === 'c').name = 'Abel'
  assert.deepEqual(f.visible(), ['a', 'b', 'user', 'c'], 'late names update labels but not positions')
  f.ready.get('c').resolve({ name: 'Abel' })
  await flush()
  assert.equal(f.latest().alphabetical, true)
  assert.deepEqual(f.visible(), ['b', 'a', 'c', 'user'])
})

test('local names form one snapshot regardless of read order or faster remote metadata', async t => {
  const f = cachedFixture(t)
  f.order.reconcile([contact('b'), contact('a'), contact('c')])
  f.local.get('b').resolve({ name: 'Zulu' })
  await flush()
  assert.equal(f.latest().localPending, true)
  f.people.find(person => person.id === 'b').name = 'Aardvark'
  f.local.get('c').reject(new Error('local storage denied'))
  f.local.get('a').resolve({ name: 'Aaron' }); f.local.get('owner').resolve({ name: 'Mona' })
  await flush()
  assert.deepEqual(f.latest().ids, ['a', 'user', 'c', 'b'], 'the seed uses original local results, not refreshed labels')
})

test('slow local reads have a short maximum wait and never reseed after the deadline', async t => {
  const f = cachedFixture(t)
  f.order.reconcile([contact('b'), contact('a'), contact('c')])
  f.local.get('b').resolve({ name: 'Zulu' }); f.local.get('a').resolve({ name: 'Aaron' })
  f.local.get('owner').resolve({ name: 'Mona' })
  await flush()
  await f.advance(INITIAL_CONTACT_CACHE_TIMEOUT_MS - 1)
  assert.equal(f.latest().localPending, true)
  await f.advance(1)
  assert.equal(f.latest().localPending, false)
  assert.equal(f.latest().alphabetical, false)
  const ids = f.latest().ids
  f.local.get('c').resolve({ name: 'Abel' })
  await flush()
  assert.deepEqual(f.latest().ids, ids)
  await f.advance(30000 - INITIAL_CONTACT_CACHE_TIMEOUT_MS)
  assert.equal(f.latest().alphabetical, true, 'the original thirty-second cap was not extended')
})

test('membership changes cannot restore removed peers or extend the local seed', async t => {
  const f = cachedFixture(t)
  f.order.reconcile([contact('b'), contact('a'), contact('c')])
  f.local.get('b').resolve({ name: 'Zulu' }); f.local.get('owner').resolve({ name: 'Mona' })
  await flush()
  f.order.reconcile([contact('b'), contact('d'), contact('a')])
  f.local.get('a').resolve({ name: 'Aaron' })
  await flush()
  assert.equal(f.latest().localPending, false)
  assert.deepEqual(f.latest().ids, ['a', 'user', 'b', 'd'])
  f.local.get('c').resolve({ name: 'Abel' })
  await flush()
  assert.deepEqual(f.latest().ids, ['a', 'user', 'b', 'd'])
})

test('closing the account ignores pending local results and clears both deadlines', async t => {
  const f = cachedFixture(t)
  f.order.reconcile([contact('a')])
  const count = f.changes.length
  f.order.close()
  f.local.get('a').resolve({ name: 'Old peer' }); f.local.get('owner').resolve({ name: 'Old self' })
  await f.advance(30000)
  assert.equal(f.changes.length, count)
})

test('a petname arriving during local preparation releases its read and seeds the new label', async t => {
  const f = cachedFixture(t)
  f.order.reconcile([contact('b'), contact('a'), contact('c')])
  f.local.get('b').resolve({ name: 'Zulu' }); f.local.get('c').resolve(null)
  f.local.get('owner').resolve({ name: 'Mona' })
  await flush()
  f.order.reconcile([contact('b'), contact('a', { petname: 'Zzz alias' }), contact('c')])
  assert.equal(f.latest().localPending, false, 'the alias does not wait for a slow cache read')
  assert.deepEqual(f.latest().ids, ['user', 'c', 'b', 'a'])
  f.local.get('a').resolve({ name: 'Aaron' })
  await flush()
  assert.deepEqual(f.latest().ids, ['user', 'c', 'b', 'a'])
})

test('fully cached peers still wait for the local own name, with no minimum preparation delay', async t => {
  const f = cachedFixture(t)
  f.order.reconcile([contact('b'), contact('a')])
  f.local.get('b').resolve({ name: 'Zulu' }); f.local.get('a').resolve({ name: 'Aaron' })
  f.ready.get('b').resolve({}); f.ready.get('a').resolve({})
  await flush()
  assert.equal(f.latest().localPending, true)
  assert.equal(f.latest().alphabetical, false)
  f.local.get('owner').resolve({ name: 'Mona' })
  await flush()
  assert.equal(f.latest().localPending, false)
  assert.equal(f.latest().alphabetical, true)
  assert.deepEqual(f.latest().ids, ['a', 'user', 'b'])
})

test('mobile includes names arriving after 250ms and finishes immediately when local reads settle', async t => {
  const resize = mobileViewport(t)
  const f = cachedFixture(t)
  f.order.reconcile([contact('b', { pinned: true }), contact('a', { pinned: true }), contact('c')])
  await f.advance(600)
  assert.equal(f.latest().localPending, true)
  resize()
  f.local.get('b').resolve({ name: 'Zulu' }); f.local.get('a').resolve({ name: 'Aaron' })
  f.local.get('c').resolve(null); f.local.get('owner').resolve({ name: 'Mona' })
  await flush()
  assert.equal(f.latest().localPending, false, 'ready names do not wait the full second')
  assert.deepEqual(f.latest().ids, ['a', 'user', 'c', 'b'])
})

test('mobile bootstrap has a one-second maximum and resize cannot shorten it', async t => {
  const resize = mobileViewport(t)
  const f = cachedFixture(t)
  f.order.reconcile([contact('b'), contact('a'), contact('c')])
  await f.advance(250)
  resize()
  await f.advance(749)
  assert.equal(f.latest().localPending, true)
  await f.advance(1)
  assert.equal(f.latest().localPending, false)
  assert.equal(f.latest().alphabetical, false)
})
