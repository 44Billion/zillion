import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHomeStartup } from '#services/home-startup.js'

const flush = async () => { for (let n = 0; n < 4; n++) await new Promise(resolve => setImmediate(resolve)) }

test('bulk work waits for prepared cache, confirmed membership and a paint opportunity', async () => {
  const cache = Promise.withResolvers()
  const frame = Promise.withResolvers()
  const work = []
  let reads = 0
  const startup = createHomeStartup({ prepare: () => { reads++; return cache.promise }, paint: async (_signal, rows) => { await rows; await frame.promise } })
  const preparing = startup.start()
  startup.defer('channels', () => work.push('obsolete channels'))
  startup.defer('channels', () => work.push('current channels'))
  startup.defer('anchors', () => work.push('anchors'))
  await flush()
  assert.equal(reads, 1)
  cache.resolve(); await preparing
  assert.deepEqual(work, [], 'preparing without confirmed contacts does not start bulk work')
  startup.expectRows()
  const ready = startup.ready()
  assert.equal(startup.start(), preparing)
  await flush()
  assert.deepEqual(work, [], 'restored rows get a paint opportunity first')
  frame.resolve(); await flush()
  assert.deepEqual(work, [], 'a frame alone cannot release rows that have not committed yet')
  startup.presented(); await ready
  assert.deepEqual(work, ['current channels', 'anchors'])
  startup.defer('channels', () => work.push('new contact'))
  assert.equal(work.at(-1), 'new contact', 'later membership changes are applied immediately')
  startup.pause()
})

test('foreground navigation bypasses a pending cache without duplicating deferred work', async () => {
  const cache = Promise.withResolvers()
  const work = []
  const startup = createHomeStartup({ prepare: () => cache.promise, paint: async () => {} })
  startup.defer('channels', () => work.push('channels'))
  const ready = startup.ready()
  startup.release()
  assert.deepEqual(work, ['channels'])
  cache.resolve(); await ready
  assert.deepEqual(work, ['channels'])
  startup.pause()
})

test('lock or owner teardown discards deferred work and stale preparation completions', async () => {
  const first = Promise.withResolvers()
  const work = []
  let reads = 0
  const startup = createHomeStartup({ prepare: () => ++reads === 1 ? first.promise : Promise.resolve(), paint: async () => {} })
  startup.defer('channels', () => work.push('old account'))
  const old = startup.ready()
  await flush()
  startup.pause()
  startup.defer('channels', () => work.push('unlocked account'))
  await startup.ready()
  first.resolve(); await old
  assert.deepEqual(work, ['unlocked account'])
  assert.equal(reads, 2)
  startup.pause()
})

test('a hidden document releases bulk work after the finite paint fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 })
  const cancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'requestAnimationFrame', original); else delete globalThis.requestAnimationFrame
    if (cancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancel); else delete globalThis.cancelAnimationFrame
  })
  let ran = false
  const startup = createHomeStartup({ prepare: async () => {} })
  startup.expectRows()
  startup.defer('channels', () => { ran = true })
  const ready = startup.ready()
  await flush()
  t.mock.timers.tick(249); await flush()
  assert.equal(ran, false)
  t.mock.timers.tick(1); await ready
  assert.equal(ran, true)
  startup.pause()
})

test('failed preparation and background work cannot block the remaining startup tasks', async () => {
  const errors = []
  const startup = createHomeStartup({ prepare: async () => { throw new Error('cache failed') }, paint: async () => {}, onError: error => errors.push(error.message) })
  let ran = false
  startup.defer('failed', () => { throw new Error('channel failed') })
  startup.defer('next', () => { ran = true })
  await startup.ready()
  assert.equal(ran, true)
  assert.deepEqual(errors, ['cache failed', 'channel failed'])
  startup.pause()
})
