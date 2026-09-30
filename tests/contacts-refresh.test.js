import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent } from 'libp2r2p/event'
import { generateSecretKey } from 'libp2r2p/key'
import { createContacts } from '#services/contacts.js'

const until = async predicate => {
  for (let n = 0; n < 200; n++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('condition not reached')
}

const pubkeyOf = secret => finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '' }, secret).pubkey

function fixture ({ owner, event, eventAfter = Infinity, isOnline = async () => true, onOnline = () => () => {}, retryDelays = [1] }) {
  let queries = 0
  const stored = []
  const stream = async function * () { yield { type: 'eose' } }
  const contacts = createContacts({
    owner,
    signer: { obfuscate: async () => 'obfuscated' },
    eventStore: {
      subscribe: () => stream(),
      add: async value => { stored.push(value) }
    },
    onChange: () => {},
    onError: () => {},
    _getEvents: async filter => {
      if (!filter.kinds?.includes(3)) return { result: [] }
      queries++
      return { result: queries >= eventAfter && event ? [{ event }] : [] }
    },
    _retryDelays: retryDelays,
    _isOnline: isOnline,
    _onOnline: onOnline
  })
  return { contacts, stored, queries: () => queries }
}

test('public list refresh retries while no local list is known and stops on close', async () => {
  const f = fixture({ owner: pubkeyOf(generateSecretKey()) })
  await f.contacts.start()
  await until(() => f.queries() >= 6)
  f.contacts.close()
  await new Promise(resolve => setTimeout(resolve, 25))
  const settled = f.queries()
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(f.queries(), settled)
})

test('public list refresh stores a list found by a later attempt', async () => {
  const secret = generateSecretKey()
  const owner = pubkeyOf(secret)
  const peer = pubkeyOf(generateSecretKey())
  const event = finalizeEvent({ kind: 3, created_at: 2, tags: [['p', peer]], content: '' }, secret)
  const f = fixture({ owner, event, eventAfter: 4 })
  await f.contacts.start()
  await until(() => f.stored.length === 1)
  assert.equal(f.stored[0].id, event.id)
  f.contacts.close()
})

test('public list refresh retries as soon as connectivity returns', async () => {
  const owner = pubkeyOf(generateSecretKey())
  let wake
  const f = fixture({
    owner,
    isOnline: async () => false,
    onOnline: handler => {
      wake = handler
      return () => { if (wake === handler) wake = null }
    },
    retryDelays: [60000]
  })
  await f.contacts.start()
  await until(() => f.queries() >= 3 && Boolean(wake))
  const before = f.queries()
  wake()
  await until(() => f.queries() > before)
  f.contacts.close()
})

function localFixture ({ publicList = null, override = null, decrypt } = {}) {
  const secret = generateSecretKey()
  const owner = pubkeyOf(secret)
  const peer = pubkeyOf(generateSecretKey())
  const states = []
  const changes = []
  const errors = []
  const streams = []
  let remoteRequests = 0
  const contacts = createContacts({
    owner,
    signer: { obfuscate: async value => value, nip44v3: { decrypt: async (...args) => decrypt ? decrypt(...args) : new TextEncoder().encode(args[3]).buffer } },
    eventStore: {
      subscribe (filter) {
        const queue = []
        let waiter
        let closed = false
        const stream = {
          filter,
          [Symbol.asyncIterator] () { return this },
          next () { return closed ? Promise.resolve({ done: true }) : queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { waiter = resolve }) },
          push (item) { const value = { value: item, done: false }; if (waiter) { const resolve = waiter; waiter = null; resolve(value) } else queue.push(value) },
          async return () { closed = true; waiter?.({ done: true }); return { done: true } }
        }
        streams.push(stream)
        if (filter.kinds[0] === 3 && publicList) stream.push({ type: 'event', event: finalizeEvent({ kind: 3, created_at: 1, tags: publicList(peer), content: '' }, secret) })
        if (filter['#k']?.[0] === '30000' && override) {
          const inner = { kind: 30000, created_at: 2, tags: [['d', '+zillion:contacts'], ...override(peer)], content: '' }
          stream.push({ type: 'event', event: finalizeEvent({ kind: 1006, created_at: 2, tags: [['c', ''], ['k', '30000'], ['v', '1']], content: JSON.stringify(inner) }, secret) })
        }
        return stream
      },
      add: async () => {}
    },
    onChange: value => changes.push(value),
    onState: value => states.push(value),
    onError: error => errors.push(error),
    _getEvents: (filter, relays, { signal }) => {
      remoteRequests++
      return signal.aborted ? Promise.resolve({ result: [] }) : new Promise(resolve => signal.addEventListener('abort', () => resolve({ result: [] }), { once: true }))
    }
  })
  return { contacts, states, changes, errors, streams, peer, remoteRequests: () => remoteRequests }
}

test('membership waits for all local lists, including an override removing a public contact', async () => {
  const f = localFixture({ publicList: peer => [['p', peer]], override: peer => [['p', peer, '', '', '0']] })
  const starting = f.contacts.start()
  assert.equal(f.contacts.start(), starting)
  await until(() => f.streams.length === 3)
  assert.deepEqual(f.states, ['loading'])
  assert.equal(f.remoteRequests(), 0, 'no relay work competes with the local snapshot')
  f.streams[0].push({ type: 'eose' }); f.streams[1].push({ type: 'eose' })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(f.changes, [], 'a partial public list cannot grant contact membership')
  f.streams[2].push({ type: 'eose' })
  assert.equal(await starting, true)
  assert.deepEqual(f.states, ['loading', 'loaded'])
  assert.deepEqual(f.changes, [[]])
  assert.equal(f.remoteRequests(), 0, 'cached public list avoids remote discovery')
  f.contacts.close()
})

test('empty local snapshots resolve nonmembership without waiting for missing public-list recovery', async () => {
  const f = localFixture()
  const starting = f.contacts.start()
  await until(() => f.streams.length === 3)
  for (const stream of f.streams) stream.push({ type: 'eose' })
  assert.equal(await starting, true)
  assert.deepEqual(f.changes, [[]])
  assert.equal(f.states.at(-1), 'loaded')
  await until(() => f.remoteRequests() > 0)
  f.contacts.close()
})

test('decryption failure stays unavailable, and retry can confirm the contact', async () => {
  let locked = true
  const f = localFixture({ override: peer => [['p', peer]], decrypt: async (...args) => { if (locked) throw new Error('VAULT_LOCKED'); return new TextEncoder().encode(args[3]).buffer } })
  const first = f.contacts.start()
  await until(() => f.streams.length === 3)
  for (const stream of f.streams) stream.push({ type: 'eose' })
  assert.equal(await first, false)
  assert.equal(f.states.at(-1), 'unavailable')
  assert.deepEqual(f.changes, [], 'an unreadable override is not an empty list')
  assert.equal(f.remoteRequests(), 0)
  locked = false
  const retry = f.contacts.start()
  await until(() => f.streams.length === 6)
  for (const stream of f.streams.slice(3)) stream.push({ type: 'eose' })
  assert.equal(await retry, true)
  assert.deepEqual(f.changes.at(-1).map(contact => contact.pubkey), [f.peer])
  assert.equal(f.states.at(-1), 'loaded')
  f.contacts.close()
})

test('close settles an incomplete initial read without publishing a late contact decision', async () => {
  const f = localFixture({ publicList: peer => [['p', peer]] })
  const starting = f.contacts.start()
  await until(() => f.streams.length === 3)
  f.contacts.close()
  assert.equal(await starting, false)
  assert.deepEqual(f.states, ['loading'])
  assert.deepEqual(f.changes, [])
})
