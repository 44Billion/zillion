import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLatestEventsByPubkey } from 'libp2r2p/relay'
import { createRelayRead } from '#services/relay-read.js'

const pubkey = 'd'.repeat(64)
const response = relays => ({ byPubkey: {}, requests: [{ phase: 'primary', authors: [pubkey], relays }] })
const fail = (relay, message, extra = {}) => ({ relay, status: 'error', error: Object.assign(new Error(message), { category: 'relay', ...extra }) })

test('mixed outcomes retry only eligible routes, without losing retry_after or restarting its deadline', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const calls = []
  const read = createRelayRead({
    pubkey, kind: 0, queryLatest: async (_pubkeys, options) => {
      calls.push(options)
      return response([
        fail('wss://blocked.test', 'blocked: private'),
        fail('wss://rate.test', 'rate-limited: busy', { retryAt: 15000, retryAfterMs: 5000 }),
        { relay: 'wss://empty.test', status: 'eose' }
      ])
    }
  })
  const signal = new AbortController().signal
  read.settle(await read.query(signal))
  assert.equal(read.nextAt, 15000)
  t.mock.timers.tick(5000)
  await read.query(signal)
  assert.deepEqual(calls[1].excludeRelaysByPubkey[pubkey], ['wss://blocked.test', 'wss://empty.test'])
})

test('operation timeout remains retryable rather than excluding aborted relays permanently', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const calls = []
  const read = createRelayRead({
    pubkey, kind: 0, timeout: 10, queryLatest: async (_pubkeys, options) => {
      calls.push(options)
      if (calls.length > 1) return response([{ relay: 'wss://slow.test', status: 'eose' }])
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
        const error = new Error('Aborted')
        options.onQueryResult({ phase: 'primary', relays: [{ relay: 'wss://slow.test', status: 'error', error }], error })
        reject(error)
      }, { once: true }))
    }
  })
  const signal = new AbortController().signal
  const work = read.query(signal)
  t.mock.timers.tick(10)
  const result = await work
  assert.equal(result.error.name, 'TimeoutError')
  read.settle(result)
  assert.equal(read.nextAt, 11010)
  t.mock.timers.tick(1000)
  await read.query(signal)
  assert.deepEqual(calls[1].excludeRelaysByPubkey[pubkey], [])
})

test('a shared relay cooldown does not block another relay and is not extended by a second reader', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const cooldowns = new Map()
  const read = createRelayRead({ pubkey, kind: 0, cooldowns })
  read.settle(response([fail('wss://rate.test', 'rate-limited: busy', { retryAt: 15000 })]))
  t.mock.timers.tick(1000)
  const other = createRelayRead({
    pubkey: 'e'.repeat(64), kind: 0, cooldowns, queryLatest: async (_keys, options) => {
      assert.deepEqual(options.excludeRelaysByPubkey['e'.repeat(64)], ['wss://rate.test'])
      return response([{ relay: 'wss://healthy.test', status: 'eose' }])
    }
  })
  other.settle(await other.query(new AbortController().signal))
  assert.equal(cooldowns.get('wss://rate.test'), 15000)
  assert.equal(other.nextAt, 15000)
})

test('unknown operation errors do not repeat automatically', () => {
  const read = createRelayRead({ pubkey, kind: 0 })
  read.settle({ requests: [], error: new Error('unknown') })
  assert.equal(read.nextAt, Infinity)
})

test('a shorter relay cooldown does not bypass a longer exponential backoff', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const read = createRelayRead({ pubkey, kind: 0 })
  read.settle(response([fail('wss://rate.test', 'rate-limited: busy')]))
  assert.equal(read.nextAt, 11000)
  t.mock.timers.tick(1000)
  read.settle(response([fail('wss://rate.test', 'rate-limited: busy', { retryAt: 11500, retryAfterMs: 500 })]))
  assert.equal(read.nextAt, 13000)
})

test('an attempt timeout preserves received events while consumer cancellation rejects', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const event = { pubkey, kind: 0, id: 'a'.repeat(64), created_at: 1 }
  const read = createRelayRead({
    pubkey, kind: 0, timeout: 10,
    queryLatest: (keys, options) => getLatestEventsByPubkey(keys, { ...options, relaysByPubkey: { [pubkey]: { write: ['wss://slow.test'] } } }),
    getEvents: async (_filter, _relays, { callback, signal }) => {
      callback({ type: 'event', event })
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }))
    }
  })
  const controller = new AbortController()
  const work = read.query(controller.signal)
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(10)
  const result = await work
  assert.equal(result.error.name, 'TimeoutError')
  assert.equal(result.byPubkey[pubkey], event)
  const cancelled = read.query(controller.signal)
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
})

test('unknown discovery failures do not repeat while other event routes remain eligible', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  let discoveries = 0
  const read = createRelayRead({
    pubkey, kind: 0,
    queryLatest: (keys, options) => getLatestEventsByPubkey(keys, {
      ...options, fallbackRelays: ['wss://fallback.test'],
      _getRelaysByPubkey: async () => { discoveries++; throw new Error('unknown discovery failure') }
    }),
    getEvents: async (_filter, relays) => ({ result: [], relays: relays.map(relay => ({ relay, status: 'eose' })) })
  })
  const signal = new AbortController().signal
  read.settle(await read.query(signal))
  assert.equal(read.nextAt, 310000)
  t.mock.timers.tick(300000)
  read.settle(await read.query(signal))
  assert.equal(discoveries, 1)
  assert.equal(read.nextAt, 610000)
})
