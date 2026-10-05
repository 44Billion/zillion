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
    _getEvents: async (filter, relays) => {
      if (!filter.kinds?.includes(3)) return { result: [], relays: relays.map(relay => ({ relay, status: 'eose' })) }
      queries++
      return { result: queries >= eventAfter && event ? [{ event }] : [], relays: relays.map(relay => ({ relay, status: 'eose' })) }
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
  let online = false
  const f = fixture({
    owner,
    isOnline: async () => online,
    onOnline: handler => {
      wake = handler
      return () => { if (wake === handler) wake = null }
    },
    retryDelays: [60000]
  })
  await f.contacts.start()
  await until(() => Boolean(wake))
  assert.equal(f.queries(), 0)
  const before = f.queries()
  online = true
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
  const writes = []
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
      add: async () => {},
      query: async () => ({ results: [] }),
      addPersonalCopy: async (event, options) => { writes.push({ event, options }); return { result: { ok: true } } }
    },
    _isOnline: async () => true,
    onChange: value => changes.push(value),
    onState: value => states.push(value),
    onError: error => errors.push(error),
    _getEvents: (filter, relays, { signal }) => {
      remoteRequests++
      return signal.aborted ? Promise.resolve({ result: [] }) : new Promise(resolve => signal.addEventListener('abort', () => resolve({ result: [] }), { once: true }))
    }
  })
  return { contacts, states, changes, errors, streams, writes, peer, remoteRequests: () => remoteRequests }
}

async function localStart (f) {
  const starting = f.contacts.start()
  await until(() => f.streams.length === 3)
  for (const stream of f.streams) stream.push({ type: 'eose' })
  assert.equal(await starting, true)
}

test('membership waits for all local lists, including an override removing a public contact', async () => {
  const f = localFixture({ publicList: peer => [['p', peer]], override: peer => [['p', peer, '', '', 'r']] })
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

test('removing a non-followed pinned contact drops its entry entirely', async () => {
  const f = localFixture({ publicList: () => [], override: peer => [['p', peer, '', '', 'p']] })
  await localStart(f)
  assert.deepEqual(f.changes.at(-1).map(contact => contact.pubkey), [f.peer])
  await f.contacts.set(f.peer, false)
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].options.context, '')
  assert.equal(f.writes[0].event.kind, 30000)
  assert.deepEqual(f.writes[0].event.tags, [['d', '+zillion:contacts']])
  assert.deepEqual(f.changes.at(-1), [])
  f.contacts.close()
})

test('removing a followed contact keeps the removed-label override', async () => {
  const f = localFixture({ publicList: peer => [['p', peer]], override: peer => [['p', peer, '', '', 'p']] })
  await localStart(f)
  await f.contacts.set(f.peer, false)
  assert.deepEqual(f.writes[0].event.tags, [['d', '+zillion:contacts'], ['p', f.peer, '', '', 'r']], 'removal clears the pin')
  assert.deepEqual(f.changes.at(-1), [])
  f.contacts.close()
})

test('an edit compacts stale removed entries and preserves live metadata', async () => {
  const stale = pubkeyOf(generateSecretKey())
  const followed = pubkeyOf(generateSecretKey())
  const f = localFixture({
    publicList: () => [['p', followed]],
    override: peer => [['p', stale, 'wss://relay.example', 'Old name', 'r'], ['p', followed, '', '', 'r'], ['p', peer, '', '', 'r']]
  })
  await localStart(f)
  await f.contacts.set(f.peer, true)
  assert.deepEqual(f.writes[0].event.tags, [
    ['d', '+zillion:contacts'],
    ['p', followed, '', '', 'r'],
    ['p', f.peer, '', '', '']
  ])
  f.contacts.close()
})

test('compaction preserves overrides while the public list is unknown', async () => {
  const f = localFixture({ override: peer => [['p', peer, '', '', '']] })
  await localStart(f)
  await f.contacts.set(f.peer, false)
  assert.deepEqual(f.writes[0].event.tags, [['d', '+zillion:contacts'], ['p', f.peer, '', '', 'r']])
  f.contacts.close()
})

test('pinning a followed contact materializes base-list metadata', async () => {
  const f = localFixture({ publicList: peer => [['p', peer, 'wss://relay.example', 'Public name']] })
  await localStart(f)
  await f.contacts.setPin(f.peer, true)
  assert.deepEqual(f.writes[0].event.tags, [['d', '+zillion:contacts'], ['p', f.peer, 'wss://relay.example', 'Public name', 'p']])
  assert.deepEqual(f.changes.at(-1).map(contact => [contact.pubkey, contact.pinned, contact.petname]), [[f.peer, true, 'Public name']])
  f.contacts.close()
})

test('a membership edit preserves an existing pin and unpin clears only the pin', async () => {
  const f = localFixture({ publicList: () => [], override: peer => [['p', peer, '', '', 'p']] })
  await localStart(f)
  await f.contacts.set(f.peer, true)
  assert.deepEqual(f.writes[0].event.tags, [['d', '+zillion:contacts'], ['p', f.peer, '', '', 'p']], 'membership edit keeps the pin')
  await f.contacts.setPin(f.peer, false)
  assert.deepEqual(f.writes[1].event.tags, [['d', '+zillion:contacts'], ['p', f.peer, '', '', '']], 'unpin keeps the contact')
  assert.equal(f.changes.at(-1)[0].pinned, false)
  f.contacts.close()
})

test('pin edits require an effective contact', async () => {
  const f = localFixture({ publicList: () => [] })
  await localStart(f)
  await assert.rejects(f.contacts.setPin(f.peer, true), /INVALID_CONTACT/)
  assert.equal(f.writes.length, 0)
  f.contacts.close()
})

test('pinning a decorated public contact writes clean tag values', async () => {
  const f = localFixture({ publicList: peer => [['p', peer, '~u=1;o=x']] })
  await localStart(f)
  await f.contacts.setPin(f.peer, true)
  assert.deepEqual(f.writes[0].event.tags, [['d', '+zillion:contacts'], ['p', f.peer, '', '', 'p']])
  assert.deepEqual(f.changes.at(-1).map(contact => [contact.pubkey, contact.petname, contact.pinned]), [[f.peer, '', true]])
  f.contacts.close()
})

test('unknown letters survive reads and every edit rewrites a canonical label', async () => {
  const f = localFixture({ publicList: () => [], override: peer => [['p', peer, '', '', 'xp']] })
  await localStart(f)
  assert.deepEqual(f.changes.at(-1).map(contact => [contact.pubkey, contact.pinned]), [[f.peer, true]], 'known letters survive unknown ones in any order')
  await f.contacts.setPin(f.peer, false)
  assert.deepEqual(f.writes[0].event.tags, [['d', '+zillion:contacts'], ['p', f.peer, '', '', '']])
  await f.contacts.setPin(f.peer, true)
  assert.deepEqual(f.writes[1].event.tags, [['d', '+zillion:contacts'], ['p', f.peer, '', '', 'p']])
  f.contacts.close()
})

test('legacy numeric labels read as unpinned contacts', async () => {
  const f = localFixture({ publicList: () => [], override: peer => [['p', peer, '', '', '0']] })
  await localStart(f)
  assert.deepEqual(f.changes.at(-1).map(contact => [contact.pubkey, contact.pinned]), [[f.peer, false]])
  f.contacts.close()
})

test('permanent relay refusals stop public-list retries across local restarts', async () => {
  let queries = 0
  const contacts = createContacts({
    owner: pubkeyOf(generateSecretKey()), signer: { obfuscate: async () => 'coordinate' },
    eventStore: { subscribe: async function * () { yield { type: 'eose' } }, add: async () => {} },
    onChange: () => {}, _isOnline: async () => true, _retryDelays: [1],
    _getEvents: async (filter, relays) => {
      if (filter.kinds.includes(10002)) return { result: [], relays: relays.map(relay => ({ relay, status: 'eose' })) }
      queries++
      return { result: [], relays: relays.map(relay => ({ relay, status: 'error', error: Object.assign(new Error('blocked: private'), { category: 'relay' }) })) }
    }
  })
  try {
    await contacts.start()
    await until(() => queries >= 3)
    await new Promise(resolve => setTimeout(resolve, 20))
    const settled = queries
    await contacts.start()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(queries, settled)
  } finally { contacts.close() }
})

test('a public-list storage failure retries its local write while offline without refetching', async () => {
  const secret = generateSecretKey()
  const event = finalizeEvent({ kind: 3, created_at: 1, tags: [], content: '' }, secret)
  let queries = 0
  let writes = 0
  let online = true
  const contacts = createContacts({
    owner: event.pubkey, signer: { obfuscate: async () => 'coordinate' },
    eventStore: {
      subscribe: async function * () { yield { type: 'eose' } },
      add: async value => { assert.equal(value.id, event.id); if (++writes === 1) { online = false; throw new Error('quota') } }
    },
    onChange: () => {}, onError: () => {}, _isOnline: async () => online,
    _getEvents: async (filter, relays) => {
      queries++
      return { result: filter.kinds.includes(3) ? [{ event }] : [], relays: relays.map(relay => ({ relay, status: 'eose' })) }
    }
  })
  try {
    await contacts.start()
    await until(() => writes === 1)
    const fetched = queries
    await contacts.start()
    await until(() => writes === 2)
    assert.equal(queries, fetched)
  } finally { contacts.close() }
})
