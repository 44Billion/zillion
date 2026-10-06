import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAvatars } from '#services/avatars.js'

const flush = async () => { for (let n = 0; n < 5; n++) await new Promise(resolve => setImmediate(resolve)) }
const image = url => ({ source: `data:image/png;base64,${url}`, width: 1, height: 1 })
const options = (url, version) => ({ url, pending: false, version })
function fixture (t, { get = async () => null, resolve = async url => image(url), ...config } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const reads = []; const requests = []; const states = []
  let online
  const service = createAvatars({
    cache: {
      get: async url => { reads.push(url); return get(url) },
      resolveImage: async (url, settings) => { requests.push({ url, settings }); return resolve(url, settings) }
    },
    onState: (key, state) => states.push({ key, state }),
    watchOnline: handler => { online = handler; return () => { online = null } },
    ...config
  })
  t.after(() => service.close())
  const confirm = key => { const candidate = service.snapshot(key)?.candidate; assert.ok(candidate); service.confirm(key, candidate, { naturalWidth: 1, naturalHeight: 1 }) }
  return { service, reads, requests, states, confirm, online: () => online?.(), advance: async ms => { t.mock.timers.tick(ms); await flush() } }
}

test('home and directory share reads, preparation, ready source and visual state', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { resolve: () => gate.promise })
  const home = f.service.retain('alice', options('a'))
  const directory = f.service.retain('alice', options('a'))
  f.service.retain('bob', options('a'))
  await flush()
  assert.deepEqual(f.reads, ['a'])
  assert.equal(f.requests.length, 1)
  home.release()
  assert.equal(f.requests[0].settings.signal.aborted, false)
  gate.resolve(image('a')); await flush()
  f.confirm('alice')
  assert.equal(f.service.snapshot('alice').displayed.src, image('a').source)
  assert.equal(f.service.snapshot('bob').initial, false, 'same-URL confirmation is shared')
  directory.release()
  f.service.retain('alice', options('a'))
  assert.equal(f.service.snapshot('alice').initial, false)
  assert.equal(f.service.snapshot('alice').candidate, null, 'already decoded bytes need no extra hidden candidate')
  assert.equal(f.requests.length, 1)
  assert.equal(f.states.at(-1).state.displayed.src, undefined, 'binary sources are outside reactive state')
})

test('persistent reads do not wait behind four occupied preparation slots', async t => {
  const gates = []
  const f = fixture(t, {
    get: async url => url === 'cached' ? image(url) : null,
    resolve: url => { const gate = Promise.withResolvers(); gates.push({ url, gate }); return gate.promise }
  })
  for (let n = 0; n < 8; n++) f.service.retain(`peer-${n}`, options(`url-${n}`))
  await flush()
  assert.equal(f.requests.length, 4)
  f.service.retain('cached-peer', options('cached'))
  await flush()
  f.confirm('cached-peer')
  assert.equal(f.service.snapshot('cached-peer').initial, false)
  assert.equal(f.requests.length, 4)
  gates[0].gate.resolve(image(gates[0].url)); await flush()
  assert.equal(f.requests.length, 5)
  f.service.close()
  for (const { url, gate } of gates) gate.resolve(image(url))
})

test('profile updates for the same URL do not restart a pending preparation', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { resolve: () => gate.promise })
  const lease = f.service.retain('alice', options('a', { created_at: 1, id: 'a' }))
  await flush()
  lease.update(options('a', { created_at: 2, id: 'b' }))
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].settings.signal.aborted, false)
  gate.resolve(image('a')); await flush(); f.confirm('alice')
})

test('a failed replacement preserves the last valid photo across new consumers; removal clears it', async t => {
  const f = fixture(t, { resolve: async url => url === 'broken' ? null : image(url) })
  const home = f.service.retain('alice', options('a', { created_at: 1, id: 'z' }))
  await flush(); f.confirm('alice')
  home.update(options('broken', { created_at: 2, id: 'z' })); await flush()
  const directory = f.service.retain('alice', options('broken', { created_at: 2, id: 'z' }))
  assert.equal(f.service.snapshot('alice').displayed.src, image('a').source)
  assert.equal(f.service.snapshot('alice').initial, false)
  home.update(options('a', { created_at: 1, id: 'a' }))
  assert.equal(f.service.snapshot('alice').picture, 'broken', 'old metadata cannot change the desired route')
  directory.update(options(null, { created_at: 3, id: 'z' }))
  assert.equal(f.service.snapshot('alice').displayed, null)
  assert.equal(f.service.snapshot('alice').initial, false)
})

test('the initial ten-second deadline survives releases, remounts and URL updates', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { resolve: () => gate.promise })
  const first = f.service.retain('alice', options('a'))
  await flush(); await f.advance(6000); first.release()
  await flush()
  f.service.retain('alice', options('a'))
  await flush(); await f.advance(3999)
  assert.equal(f.service.snapshot('alice').initial, true)
  await f.advance(1)
  assert.equal(f.service.snapshot('alice').initial, false)
  gate.resolve(image('a')); await flush(); f.confirm('alice')
  assert.equal(f.service.snapshot('alice').initial, false)
})

test('online recovery shares one observer and never reopens the pulse', async t => {
  let succeed = false
  const f = fixture(t, { resolve: async url => succeed ? image(url) : null })
  f.service.retain('alice', options('a')); f.service.retain('bob', options('a'))
  await flush()
  assert.equal(f.requests.length, 1)
  assert.equal(f.service.snapshot('alice').initial, false)
  succeed = true; f.online(); await flush()
  assert.equal(f.requests.length, 2)
  f.confirm('alice')
  assert.equal(f.service.snapshot('bob').initial, false)
  assert.ok(f.service.snapshot('bob').displayed)
})

test('last consumer release cancels work; old responses and confirmations cannot leak to a new service', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { resolve: () => gate.promise })
  const a = f.service.retain('alice', options('a'))
  const b = f.service.retain('alice', options('a'))
  await flush(); a.release()
  assert.equal(f.requests[0].settings.signal.aborted, false)
  b.release(); assert.equal(f.requests[0].settings.signal.aborted, true)
  f.service.close(); gate.resolve(image('a')); await flush()
  assert.equal(f.service.snapshot('alice'), null)
  const fresh = createAvatars({ cache: { get: async () => image('a') }, onState: () => {}, watchOnline: () => () => {} })
  t.after(() => fresh.close())
  fresh.retain('alice', options('a')); await flush()
  const candidate = fresh.snapshot('alice').candidate
  fresh.confirm('alice', { ...candidate, id: 'old:1' })
  assert.equal(fresh.snapshot('alice').displayed, null)
})

test('idle image memory is bounded while ready photos used by mounted views remain reusable', async t => {
  const f = fixture(t, { maxIdleBytes: 1 })
  const a = f.service.retain('alice', options('a'))
  await flush(); f.confirm('alice')
  const b = f.service.retain('bob', options('b'))
  await flush(); f.confirm('bob')
  assert.equal(f.service.stats().sources, 2, 'active views keep their already displayed sources')
  b.release()
  assert.equal(f.service.stats().sources, 1)
  assert.equal(f.service.stats().idleBytes, 0)
  f.service.retain('directory-alice', options('a'))
  assert.equal(f.service.snapshot('directory-alice').initial, false)
  assert.equal(f.requests.length, 2)
  a.release()
})

test('failed local or HTTP preparation ends loading and cannot occupy a slot forever', async t => {
  const f = fixture(t, { resolve: () => new Promise(() => {}) })
  for (let n = 0; n < 5; n++) f.service.retain(String(n), options(String(n)))
  await flush()
  await f.advance(15000)
  assert.equal(f.requests.length, 5)
  assert.equal(f.service.snapshot('0').initial, false)
})

test('evicting an unconfirmed idle source drops its candidate payload as well', async t => {
  const f = fixture(t, { maxIdleBytes: 1 })
  const lease = f.service.retain('alice', options('a'))
  await flush()
  assert.ok(f.service.snapshot('alice').candidate)
  lease.release()
  assert.equal(f.service.snapshot('alice').candidate, null)
  assert.equal(f.service.stats().sources, 0)
})

test('native CORS fallbacks retain their loaded drawable without pretending to persist bytes', async t => {
  const f = fixture(t, { resolve: async url => ({ source: url, width: 1, height: 1 }) })
  f.service.retain('alice', options('https://native.test/photo.png'))
  await flush()
  const loaded = { naturalWidth: 1, naturalHeight: 1 }
  f.service.confirm('alice', f.service.snapshot('alice').candidate, loaded)
  f.service.retain('bob', options('https://native.test/photo.png'))
  const candidate = f.service.snapshot('bob').candidate
  assert.equal(f.service.snapshot('bob').initial, false)
  assert.equal(f.service.drawable('bob'), loaded)
  f.service.reject('bob', candidate)
  assert.ok(f.service.snapshot('alice').displayed)
  assert.equal(f.service.drawable('bob'), loaded)
  f.online()
  assert.notEqual(f.service.snapshot('bob').candidate.id, candidate.id, 'online recovery rechecks the native DOM source')
  assert.equal(f.requests.length, 1, 'ready native results need no repeated CORS preparation')
})
