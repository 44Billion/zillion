import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent } from 'libp2r2p/event'
import { generateSecretKey } from 'libp2r2p/key'
import {
  CONTACTS_DTAG,
  CONTACT_LIST_KIND,
  createContacts,
  contactMembership,
  contactSelfPinned,
  LEGACY_CONTACT_LIST_KIND,
  migrateLegacyContactList
} from '#services/contacts.js'

const until = async predicate => {
  for (let n = 0; n < 300; n++) {
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
      query: async () => ({ results: [] }),
      add: async value => { stored.push(value) }
    },
    onChange: () => {},
    onError: () => {},
    canMigrate: () => false,
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

function personalCopy (secret, inner, context = '', { address = false } = {}) {
  const kind = inner.kind
  const tags = [['c', context], ['k', String(kind)], ['v', '1']]
  if (address) tags.push(['d', `obfuscated:${kind}:${inner.created_at}`])
  return finalizeEvent({
    kind: 1006,
    created_at: inner.created_at,
    tags,
    content: JSON.stringify(inner)
  }, secret)
}

function localFixture ({
  publicList = null,
  override = null,
  newOverride = null,
  deletions = [],
  decrypt,
  save,
  canMigrate = false,
  now = () => Date.now(),
  ownerSecret
} = {}) {
  const secret = ownerSecret || generateSecretKey()
  const owner = pubkeyOf(secret)
  const peer = pubkeyOf(generateSecretKey())
  const states = []
  const changes = []
  const selfPins = []
  const errors = []
  const streams = []
  const writes = []
  const queries = []
  let remoteRequests = 0
  let currentNew = newOverride
    ? { kind: CONTACT_LIST_KIND, created_at: 2, tags: newOverride(peer, owner), content: '' }
    : null
  const currentLegacy = override
    ? { kind: LEGACY_CONTACT_LIST_KIND, created_at: 2, tags: [['d', CONTACTS_DTAG], ...override(peer, owner)], content: '' }
    : null
  const currentDeletions = [...deletions]
  const deletionCutoff = () => currentDeletions
    .filter(event => event.tags.some(tag => tag[0] === 'a' && tag[1] === `${LEGACY_CONTACT_LIST_KIND}:${owner}:${CONTACTS_DTAG}`))
    .reduce((cutoff, event) => Math.max(cutoff, event.created_at), 0)
  const wrapper = inner => personalCopy(secret, inner, '', { address: inner.kind === LEGACY_CONTACT_LIST_KIND })
  const eventsFor = filter => {
    const kind = filter['#k']?.[0]
    if (kind === String(CONTACT_LIST_KIND)) return currentNew ? [wrapper(currentNew)] : []
    if (kind === String(LEGACY_CONTACT_LIST_KIND)) {
      return currentLegacy && currentLegacy.created_at > deletionCutoff() ? [wrapper(currentLegacy)] : []
    }
    if (kind === '5') return currentDeletions.map(wrapper)
    return []
  }
  const contacts = createContacts({
    owner,
    signer: {
      obfuscate: async value => value,
      nip44v3: { decrypt: async (...args) => decrypt ? decrypt(...args) : new TextEncoder().encode(args[3]).buffer }
    },
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
        if (filter.kinds[0] === 3 && publicList) stream.push({ type: 'event', event: finalizeEvent({ kind: 3, created_at: 1, tags: publicList(peer, owner), content: '' }, secret) })
        for (const event of eventsFor(filter)) stream.push({ type: 'event', event })
        return stream
      },
      add: async () => {},
      query: async filter => {
        queries.push(filter)
        return { results: eventsFor(filter) }
      },
      addPersonalCopy: async (event, options) => {
        writes.push({ event, options })
        const result = save ? save(event, options) : { result: { ok: true } }
        if (result?.result?.ok) {
          if (event.kind === CONTACT_LIST_KIND) currentNew = event
          if (event.kind === DELETION_KIND) currentDeletions.push(event)
        }
        return result
      }
    },
    canMigrate: () => canMigrate,
    _now: now,
    _isOnline: async () => true,
    onChange: (value, { selfPinned }) => { changes.push(value); selfPins.push(selfPinned) },
    onState: value => states.push(value),
    onError: error => errors.push(error),
    _getEvents: (filter, relays, { signal }) => {
      remoteRequests++
      return signal.aborted ? Promise.resolve({ result: [] }) : new Promise(resolve => signal.addEventListener('abort', () => resolve({ result: [] }), { once: true }))
    }
  })
  return {
    contacts,
    states,
    changes,
    selfPins,
    errors,
    streams,
    writes,
    queries,
    owner,
    peer,
    legacyEvent: (tags, createdAt = 2) => wrapper({ kind: LEGACY_CONTACT_LIST_KIND, created_at: createdAt, tags: [['d', CONTACTS_DTAG], ...tags], content: '' }),
    remoteRequests: () => remoteRequests
  }
}

const DELETION_KIND = 5

async function finishStart (f, from = 0) {
  const starting = f.contacts.start()
  await until(() => f.streams.length >= from + 4)
  for (const stream of f.streams.slice(from)) stream.push({ type: 'eose' })
  assert.equal(await starting, true)
}

async function localStart (f) {
  await finishStart(f)
}

test('membership waits for all local snapshots and applies migrated pp overrides', async () => {
  const f = localFixture({ publicList: peer => [['p', peer]], override: peer => [['p', peer, '', '', 'r']] })
  const starting = f.contacts.start()
  await until(() => f.streams.length === 4)
  assert.deepEqual(f.states, ['loading'])
  assert.equal(f.remoteRequests(), 0, 'no relay work competes with the local snapshot')
  f.streams[0].push({ type: 'eose' }); f.streams[1].push({ type: 'eose' })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(f.changes, [], 'a partial public list cannot grant contact membership')
  f.streams[2].push({ type: 'eose' }); f.streams[3].push({ type: 'eose' })
  assert.equal(await starting, true)
  assert.deepEqual(f.states, ['loading', 'loaded'])
  assert.deepEqual(f.changes, [[]])
  assert.equal(f.remoteRequests(), 0, 'cached public list avoids remote discovery')
  assert.equal(f.writes.length, 0, 'read-only migration remains in memory')
  f.contacts.close()
})

test('empty local snapshots resolve nonmembership without waiting for missing public-list recovery', async () => {
  const f = localFixture()
  await localStart(f)
  assert.deepEqual(f.changes, [[]])
  assert.equal(f.states.at(-1), 'loaded')
  await until(() => f.remoteRequests() > 0)
  f.contacts.close()
})

test('decryption failure stays unavailable, and retry can confirm the contact', async () => {
  let locked = true
  const f = localFixture({ override: peer => [['p', peer]], decrypt: async (...args) => { if (locked) throw new Error('VAULT_LOCKED'); return new TextEncoder().encode(args[3]).buffer } })
  const first = f.contacts.start()
  await until(() => f.streams.length === 4)
  for (const stream of f.streams) stream.push({ type: 'eose' })
  assert.equal(await first, false)
  assert.equal(f.states.at(-1), 'unavailable')
  assert.deepEqual(f.changes, [], 'an unreadable override is not an empty list')
  assert.equal(f.remoteRequests(), 0)
  locked = false
  const retry = f.contacts.start()
  await until(() => f.streams.length === 8)
  for (const stream of f.streams.slice(4)) stream.push({ type: 'eose' })
  assert.equal(await retry, true)
  assert.deepEqual(f.changes.at(-1).map(contact => contact.pubkey), [f.peer])
  assert.equal(f.states.at(-1), 'loaded')
  f.contacts.close()
})

test('close settles an incomplete initial read without publishing a late contact decision', async () => {
  const f = localFixture({ publicList: peer => [['p', peer]] })
  const starting = f.contacts.start()
  await until(() => f.streams.length === 4)
  f.contacts.close()
  assert.equal(await starting, false)
  assert.deepEqual(f.states, ['loading'])
  assert.deepEqual(f.changes, [])
})

test('legacy migration sanitizes CRDT metadata and extra p fields', () => {
  const legacy = {
    kind: LEGACY_CONTACT_LIST_KIND,
    created_at: 100,
    tags: [
      ['d', CONTACTS_DTAG],
      ['p', 'b'.repeat(64), 'wss://peer.example', 'Peer', 'p', '~u=1;o=extra', 'ignored'],
      ['p', 'invalid'],
      ['~', 'u=1'],
      ['z', 'p^' + 'c'.repeat(64), '~u=2'],
      ['zz', 'x^A', '~u=3;i=0'],
      ['x', 'A', '~u=4;o=x'],
      ['t', 'keep', '~u=5']
    ],
    content: 'preserved'
  }
  assert.deepEqual(migrateLegacyContactList(legacy, 150_000), {
    kind: CONTACT_LIST_KIND,
    created_at: 150,
    tags: [
      ['pp', 'b'.repeat(64), 'wss://peer.example', 'Peer', 'p'],
      ['x', 'A'],
      ['t', 'keep']
    ],
    content: 'preserved'
  })
  assert.equal(migrateLegacyContactList({ ...legacy, created_at: 200 }, 150_000).created_at, 200)
})

test('successful startup migration writes 13300 before its private coordinate deletion', async () => {
  const f = localFixture({
    override: peer => [['p', peer, 'wss://peer.example', 'Peer', 'p', '~u=1;o=x'], ['d', 'extra'], ['z', 'p^old', '~u=2']],
    canMigrate: true,
    now: () => 150_000
  })
  try {
    await localStart(f)
    await until(() => f.writes.length === 2)
    const [migrated, deletion] = f.writes.map(write => write.event)
    assert.equal(migrated.kind, CONTACT_LIST_KIND)
    assert.equal(migrated.created_at, 150)
    assert.deepEqual(migrated.tags, [['pp', f.peer, 'wss://peer.example', 'Peer', 'p']])
    assert.equal(deletion.kind, DELETION_KIND)
    assert.deepEqual(deletion.tags, [
      ['a', `${LEGACY_CONTACT_LIST_KIND}:${f.owner}:${CONTACTS_DTAG}`],
      ['k', String(LEGACY_CONTACT_LIST_KIND)]
    ])
    assert.deepEqual(f.writes.map(write => write.options), [{ context: '' }, { context: '' }])
    assert.deepEqual(f.errors, [])
  } finally { f.contacts.close() }
})

test('failed 13300 write keeps the legacy override and never emits deletion', async () => {
  const f = localFixture({
    override: peer => [['p', peer]],
    canMigrate: true,
    save: event => event.kind === CONTACT_LIST_KIND ? { result: { ok: false } } : { result: { ok: true } }
  })
  try {
    await localStart(f)
    await until(() => f.errors.length === 1)
    assert.deepEqual(f.writes.map(write => write.event.kind), [CONTACT_LIST_KIND])
    assert.match(f.errors[0].message, /CONTACT_STORAGE_FAILED/)
    assert.deepEqual(f.changes.at(-1).map(contact => contact.pubkey), [f.peer])
  } finally { f.contacts.close() }
})

test('a valid empty 13300 is authoritative over legacy data', async () => {
  const f = localFixture({ newOverride: () => [], override: peer => [['p', peer]] })
  try {
    await localStart(f)
    assert.deepEqual(f.changes.at(-1), [])
    assert.equal(f.writes.length, 0)
    assert.equal(f.queries.some(filter => filter['#d']), false, 'startup reads 13300 without the legacy address')
  } finally { f.contacts.close() }
})

test('removing a non-followed pinned contact drops its pp entry', async () => {
  const f = localFixture({ publicList: () => [], override: peer => [['p', peer, '', '', 'p']] })
  await localStart(f)
  assert.deepEqual(f.changes.at(-1).map(contact => contact.pubkey), [f.peer])
  await f.contacts.set(f.peer, false)
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].options.context, '')
  assert.equal(f.writes[0].event.kind, CONTACT_LIST_KIND)
  assert.deepEqual(f.writes[0].event.tags, [])
  assert.deepEqual(f.changes.at(-1), [])
  f.contacts.close()
})

test('removing a followed contact keeps its removed pp override', async () => {
  const f = localFixture({ publicList: peer => [['p', peer]], override: peer => [['p', peer, '', '', 'p']] })
  await localStart(f)
  await f.contacts.set(f.peer, false)
  assert.deepEqual(f.writes[0].event.tags, [['pp', f.peer, '', '', 'r']], 'removal clears the pin')
  assert.deepEqual(f.changes.at(-1), [])
  f.contacts.close()
})

test('editing a 13300 preserves legitimate CRDT metadata outside the changed entry', async () => {
  const other = pubkeyOf(generateSecretKey())
  const f = localFixture({
    publicList: () => [['p', other]],
    newOverride: (peer, owner) => [
      ['pp', owner, '', '', 'p', '~u=1;o=x'],
      ['pp', other, 'wss://peer.example', 'Peer', 'p', '~u=2;o=y'],
      ['x', 'A', '~u=3;o=z']
    ]
  })
  try {
    await localStart(f)
    await f.contacts.setPin(f.owner, false)
    assert.deepEqual(f.writes[0].event.tags, [
      ['pp', other, 'wss://peer.example', 'Peer', 'p', '~u=2;o=y'],
      ['x', 'A', '~u=3;o=z']
    ])
  } finally { f.contacts.close() }
})

test('an edit compacts stale removed pp entries and preserves live metadata', async () => {
  const stale = pubkeyOf(generateSecretKey())
  const followed = pubkeyOf(generateSecretKey())
  const f = localFixture({
    publicList: () => [['p', followed]],
    override: peer => [['p', stale, 'wss://relay.example', 'Old name', 'r'], ['p', followed, '', '', 'r'], ['p', peer, '', '', 'r']]
  })
  await localStart(f)
  await f.contacts.set(f.peer, true)
  assert.deepEqual(f.writes[0].event.tags, [
    ['pp', followed, '', '', 'r'],
    ['pp', f.peer, '', '', '']
  ])
  f.contacts.close()
})

test('compaction preserves overrides while the public list is unknown', async () => {
  const f = localFixture({ override: peer => [['p', peer, '', '', '']] })
  await localStart(f)
  await f.contacts.set(f.peer, false)
  assert.deepEqual(f.writes[0].event.tags, [['pp', f.peer, '', '', 'r']])
  f.contacts.close()
})

test('pinning a followed contact materializes base-list metadata', async () => {
  const f = localFixture({ publicList: peer => [['p', peer, 'wss://relay.example', 'Public name']] })
  await localStart(f)
  await f.contacts.setPin(f.peer, true)
  assert.deepEqual(f.writes[0].event.tags, [['pp', f.peer, 'wss://relay.example', 'Public name', 'p']])
  assert.deepEqual(f.changes.at(-1).map(contact => [contact.pubkey, contact.pinned, contact.petname]), [[f.peer, true, 'Public name']])
  f.contacts.close()
})

test('membership edits preserve pins, and unpin clears only the pin', async () => {
  const f = localFixture({ publicList: () => [], override: peer => [['p', peer, '', '', 'p']] })
  await localStart(f)
  await f.contacts.set(f.peer, true)
  assert.deepEqual(f.writes[0].event.tags, [['pp', f.peer, '', '', 'p']], 'membership edit keeps the pin')
  await f.contacts.setPin(f.peer, false)
  assert.deepEqual(f.writes[1].event.tags, [['pp', f.peer, '', '', '']], 'unpin keeps the contact')
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

test('pinning a decorated public contact writes clean pp values', async () => {
  const f = localFixture({ publicList: peer => [['p', peer, '~u=1;o=x']] })
  await localStart(f)
  await f.contacts.setPin(f.peer, true)
  assert.deepEqual(f.writes[0].event.tags, [['pp', f.peer, '', '', 'p']])
  assert.deepEqual(f.changes.at(-1).map(contact => [contact.pubkey, contact.petname, contact.pinned]), [[f.peer, '', true]])
  f.contacts.close()
})

test('unknown letters survive reads and every edit rewrites a canonical label', async () => {
  const f = localFixture({ publicList: () => [], override: peer => [['p', peer, '', '', 'xp']] })
  await localStart(f)
  assert.deepEqual(f.changes.at(-1).map(contact => [contact.pubkey, contact.pinned]), [[f.peer, true]], 'known letters survive unknown ones in any order')
  await f.contacts.setPin(f.peer, false)
  assert.deepEqual(f.writes[0].event.tags, [['pp', f.peer, '', '', '']])
  await f.contacts.setPin(f.peer, true)
  assert.deepEqual(f.writes[1].event.tags, [['pp', f.peer, '', '', 'p']])
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
    owner: pubkeyOf(generateSecretKey()),
    signer: { obfuscate: async () => 'coordinate' },
    eventStore: {
      subscribe: async function * () { yield { type: 'eose' } },
      query: async () => ({ results: [] }),
      add: async () => {}
    },
    onChange: () => {},
    onError: () => {},
    canMigrate: () => false,
    _isOnline: async () => true,
    _retryDelays: [1],
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
    owner: event.pubkey,
    signer: { obfuscate: async () => 'coordinate' },
    eventStore: {
      subscribe: async function * () { yield { type: 'eose' } },
      query: async () => ({ results: [] }),
      add: async value => { assert.equal(value.id, event.id); if (++writes === 1) { online = false; throw new Error('quota') } }
    },
    onChange: () => {},
    onError: () => {},
    canMigrate: () => false,
    _isOnline: async () => online,
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

test('self pin is private preference only and never grants peer membership', () => {
  const owner = 'a'.repeat(64)
  const peer = 'b'.repeat(64)
  const list = tags => ({ pubkey: owner, tags })
  for (const [label, pinned] of [['p', true], ['xp', true], ['rp', false], ['', false], ['0', false], ['~u=p', false]]) {
    const lists = [list([['p', owner]]), list([['p', owner, '', '', 'p']]), list([['pp', owner, '', '', label], ['pp', peer, '', '', 'p']])]
    assert.equal(contactSelfPinned(lists, owner), pinned)
    assert.deepEqual(contactMembership(lists, owner).map(contact => contact.pubkey), [peer])
  }
  assert.equal(contactSelfPinned([list([['p', owner, '', '', 'p']]), null, null], owner), false, 'kind 3 cannot set self pin')
  assert.equal(contactSelfPinned([null, null, { pubkey: peer, tags: [['pp', owner, '', '', 'p']] }], owner), false, 'another author cannot set self pin')
})

test('self pin writes canonical pp entries and unpin retains peer metadata', async () => {
  const f = localFixture({ publicList: peer => [['p', peer]], override: peer => [['p', peer, 'wss://peer.example', 'Peer', 'p', '~u=1;o=x']] })
  try {
    await localStart(f)
    assert.equal(f.selfPins.at(-1), false)
    await f.contacts.setPin(f.owner, true)
    assert.deepEqual(f.writes[0].event.tags.at(-1), ['pp', f.owner, '', '', 'p'])
    assert.equal(f.writes[0].options.context, '')
    assert.equal(f.selfPins.at(-1), true)
    assert.deepEqual(f.changes.at(-1).map(contact => contact.pubkey), [f.peer])
    await f.contacts.setPin(f.owner, false)
    assert.deepEqual(f.writes[1].event.tags, [['pp', f.peer, 'wss://peer.example', 'Peer', 'p']])
    assert.equal(f.selfPins.at(-1), false)
    await f.contacts.setPin(f.owner, false)
    assert.equal(f.writes.length, 2, 'unpinning an absent self entry is a noop')
    await assert.rejects(f.contacts.set(f.owner, true), /INVALID_CONTACT/)
  } finally { f.contacts.close() }
})

test('self unpin removes its pp entry even when the public snapshot is unknown', async () => {
  const f = localFixture({ override: (peer, owner) => [['p', owner, '', '', 'p']] })
  try {
    await localStart(f)
    assert.equal(f.selfPins.at(-1), true)
    await f.contacts.setPin(f.owner, false)
    assert.deepEqual(f.writes[0].event.tags, [])
  } finally { f.contacts.close() }
})

test('concurrent edits share the write queue and preserve each other', async () => {
  const f = localFixture({ publicList: peer => [['p', peer, 'wss://peer.example', 'Peer']] })
  try {
    await localStart(f)
    await Promise.all([f.contacts.setPin(f.owner, true), f.contacts.setPin(f.peer, true), f.contacts.setPin(f.owner, false)])
    assert.equal(f.writes.length, 3)
    assert.deepEqual(f.writes[2].event.tags, [['pp', f.peer, 'wss://peer.example', 'Peer', 'p']])
    assert.deepEqual(f.selfPins, [false, true, true, false])
  } finally { f.contacts.close() }
})

test('account-scoped Web Lock cancellation releases a waiting migration', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let request
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request (name, options) {
          request = { name, signal: options.signal }
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
          })
        }
      }
    }
  })
  const f = localFixture({ override: peer => [['p', peer]], canMigrate: true })
  try {
    const starting = f.contacts.start()
    await until(() => f.streams.length === 4)
    for (const stream of f.streams) stream.push({ type: 'eose' })
    assert.equal(await starting, true)
    await until(() => Boolean(request))
    assert.equal(request.name, `zillion:contacts:${f.owner}`)
    assert.equal(request.signal.aborted, false)
    f.contacts.close()
    assert.equal(request.signal.aborted, true)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(f.writes.length, 0)
  } finally {
    f.contacts.close()
    Object.defineProperty(globalThis, 'navigator', originalNavigator)
  }
})

test('maintenance emits a new deletion only above the previous legacy cutoff', async () => {
  const ownerSecret = generateSecretKey()
  const owner = pubkeyOf(ownerSecret)
  const deletion = { kind: DELETION_KIND, created_at: 1000, tags: [['a', `${LEGACY_CONTACT_LIST_KIND}:${owner}:${CONTACTS_DTAG}`], ['k', String(LEGACY_CONTACT_LIST_KIND)]], content: '' }
  const below = localFixture({
    ownerSecret,
    newOverride: () => [],
    override: peer => [['p', peer]],
    deletions: [deletion],
    canMigrate: true,
    now: () => 1_000_000
  })
  try {
    // The legacy fixture timestamp is below the persisted deletion cutoff, so
    // event-store deletion filtering removes it before presentation.
    await localStart(below)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(below.writes.length, 0)
  } finally { below.contacts.close() }
  // A newer legacy copy requires a newer cutoff even though 13300 remains
  // authoritative and the old deletion is retained only as a hint.
  const late = localFixture({
    ownerSecret,
    newOverride: () => [],
    override: peer => [['p', peer]],
    deletions: [{ ...deletion, created_at: 1 }],
    canMigrate: true,
    now: () => 1_000_000
  })
  try {
    await localStart(late)
    await until(() => late.writes.length === 1)
    assert.equal(late.writes[0].event.kind, DELETION_KIND)
    assert.equal(late.writes[0].event.created_at, 1000)
  } finally { late.contacts.close() }
})

test('a legacy copy arriving after migration is tombstoned without replacing 13300', async () => {
  const f = localFixture({ newOverride: () => [], canMigrate: true, now: () => 2_000_000 })
  try {
    await localStart(f)
    await until(() => f.streams.length === 5)
    const event = f.legacyEvent([['p', f.peer]], 100)
    f.streams[4].push({ type: 'event', event })
    await until(() => f.writes.length === 1)
    assert.equal(f.writes[0].event.kind, DELETION_KIND)
    assert.equal(f.writes[0].event.created_at, 2000)
    assert.deepEqual(f.changes.at(-1), [])
  } finally { f.contacts.close() }
})

test('refused edits preserve the previous pin and membership', async () => {
  const f = localFixture({ publicList: () => [], override: peer => [['p', peer, '', '', 'p']], save: () => ({ result: { ok: false } }) })
  try {
    await localStart(f)
    await assert.rejects(f.contacts.setPin(f.peer, false), /CONTACT_STORAGE_FAILED/)
    assert.equal(f.selfPins.at(-1), false)
    assert.deepEqual(f.changes.at(-1).map(contact => [contact.pubkey, contact.pinned]), [[f.peer, true]])
  } finally { f.contacts.close() }
})
