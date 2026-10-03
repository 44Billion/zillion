import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent } from 'libp2r2p/event'
import { generateSecretKey } from 'libp2r2p/key'
import { PERSONAL_COPY } from 'libp2r2p/kind'
import { createReadState, createUnreadCounter, createOutgoingReads, parseReadAnchors, chooseReadAnchor } from '#services/read-state.js'

const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))
const until = async predicate => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await tick()
  }
  assert.fail('condition not reached')
}

const pubkeyOf = secret => finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '' }, secret).pubkey
const hex = value => String(value).padStart(64, value)
const obfuscate = async (value, kind, scope) => `${scope || 'root'}|${kind}|${value}`
const emptyContext = `root|${PERSONAL_COPY}|`
const signer = {
  obfuscate,
  // Personal copies are opaque to this test; the plaintext is the ciphertext.
  nip44v3: { decrypt: async (pubkey, kind, scope, content) => new TextEncoder().encode(content) }
}

function copy ({ secret, inner, context = '', coordinate, provenance = '1', createdAt = inner.created_at }) {
  return finalizeEvent({
    kind: PERSONAL_COPY,
    created_at: createdAt,
    tags: [['k', String(inner.kind)], ['c', context], ['v', provenance], ['d', coordinate]],
    content: JSON.stringify(inner)
  }, secret)
}

function readFixture ({ stored = [] } = {}) {
  const secret = generateSecretKey()
  const pubkey = pubkeyOf(secret)
  const peer = pubkeyOf(generateSecretKey())
  const writes = []
  let failWrites = false
  let context = ''
  let coordinate = ''
  const listeners = new Set()
  const eventStore = {
    async addPersonalCopy (event) {
      writes.push(event)
      if (failWrites) return { result: { ok: false, code: 'denied' } }
      const wrapper = copy({ secret, inner: event, context, coordinate, provenance: '1', createdAt: event.created_at })
      for (const listener of listeners) listener(wrapper)
      return { result: { ok: true } }
    },
    subscribe (filter) {
      context = filter['#c'][0]
      coordinate = filter['#d'][0]
      const queue = [...stored.map(event => ({ type: 'event', event })), { type: 'eose' }]
      let wake
      const push = value => { if (wake) { const resolve = wake; wake = null; resolve({ value, done: false }) } else queue.push(value) }
      listeners.add(push)
      return {
        [Symbol.asyncIterator] () { return this },
        next: () => queue.length ? Promise.resolve({ value: queue.shift(), done: false }) : new Promise(resolve => { wake = resolve }),
        return: async () => { listeners.delete(push); wake?.({ done: true }); return { done: true } }
      }
    }
  }
  return { secret, pubkey, peer, writes, eventStore, listeners, setFail (value) { failWrites = value }, get context () { return context }, get coordinate () { return coordinate } }
}

test('advance writes one anchor tag per peer, monotonic versions and no rewrite of the same anchor', async () => {
  const f = readFixture()
  const errors = []
  const reads = createReadState({ pubkey: f.pubkey, signer, eventStore: f.eventStore, writeDelayMs: 5, onError: error => errors.push(error) })
  try {
    assert.equal(await reads.ensure(f.peer), true)
    assert.equal(f.context, `root|${PERSONAL_COPY}|`)
    assert.equal(f.coordinate, `.coordinate|${PERSONAL_COPY}|${f.context}:${30078}:${f.pubkey}:+zillion:read:${f.peer}`)
    reads.advance(f.peer, { id: hex('a'), created_at: 100 })
    await until(() => f.writes.length === 1)
    const first = f.writes[0]
    assert.equal(first.kind, 30078)
    assert.equal(first.content, '')
    assert.deepEqual(first.tags, [['d', `+zillion:read:${f.peer}`], ['anchor', hex('a'), '100']])
    assert.equal(reads.anchor(f.peer).id, hex('a'))
    assert.deepEqual(errors, [])
    // Repeating the same anchor does not schedule another version.
    reads.advance(f.peer, { id: hex('a'), created_at: 100 })
    await reads.flush(f.peer)
    assert.equal(f.writes.length, 1)
    reads.advance(f.peer, { id: hex('b'), created_at: 101 })
    await reads.flush(f.peer)
    assert.equal(f.writes.length, 2)
    assert.ok(f.writes[1].created_at > f.writes[0].created_at)
    assert.deepEqual(f.writes[1].tags[1], ['anchor', hex('b'), '101'])
  } finally { reads.close() }
})

test('parser keeps only portable anchor slots, picks the newest and repairs duplicates to one tag', async () => {
  const f = readFixture()
  const higher = hex('f')
  const lower = hex('0')
  const inner = {
    kind: 30078,
    created_at: 500,
    // Reserved CRDT metadata may decorate extra slots; the parser ignores it.
    tags: [['d', `+zillion:read:${f.peer}`], ['anchor', higher, '100', '~u=1;o=a'], ['anchor', lower, '100', '~u=2;o=b']],
    content: ''
  }
  const stored = [copy({ secret: f.secret, inner, context: emptyContext, coordinate: 'coord', provenance: '1', created_at: 500 })]
  // Wrappers deliver the same context/coordinate this service derives.
  f.eventStore.subscribe = function (filter) {
    assert.equal(filter.limit, 1)
    const queue = [...stored.map(event => ({ type: 'event', event })), { type: 'eose' }]
    return {
      [Symbol.asyncIterator] () { return this },
      next: () => queue.length ? Promise.resolve({ value: queue.shift(), done: false }) : new Promise(() => {}),
      return: async () => ({ done: true })
    }
  }
  const reads = createReadState({ pubkey: f.pubkey, signer, eventStore: f.eventStore, writeDelayMs: 5, onError: () => {} })
  try {
    await reads.ensure(f.peer)
    assert.deepEqual(reads.anchor(f.peer), { id: lower, created_at: 100 })
    await reads.flush(f.peer)
    assert.equal(f.writes.length, 1)
    const anchors = f.writes[0].tags.filter(tag => tag[0] === 'anchor')
    assert.deepEqual(anchors, [['anchor', lower, '100']], 'repair keeps a single canonical anchor')
  } finally { reads.close() }
})

test('merge keeps the newest anchor across versions and re-persists it', async () => {
  const f = readFixture()
  const newerAnchor = { id: hex('a'), created_at: 200 }
  const olderAnchor = { id: hex('b'), created_at: 100 }
  const first = {
    kind: 30078,
    created_at: 500,
    tags: [['d', `+zillion:read:${f.peer}`], ['anchor', newerAnchor.id, String(newerAnchor.created_at)]],
    content: ''
  }
  const second = {
    kind: 30078,
    created_at: 600,
    tags: [['d', `+zillion:read:${f.peer}`], ['anchor', olderAnchor.id, String(olderAnchor.created_at)]],
    content: ''
  }
  let push
  f.eventStore.subscribe = function () {
    const queue = [{ type: 'event', event: copy({ secret: f.secret, inner: first, context: emptyContext, coordinate: 'coord' }) }, { type: 'eose' }]
    return {
      [Symbol.asyncIterator] () { return this },
      next: () => queue.length ? Promise.resolve({ value: queue.shift(), done: false }) : new Promise(resolve => { push = value => resolve({ value, done: false }) }),
      return: async () => ({ done: true })
    }
  }
  const reads = createReadState({ pubkey: f.pubkey, signer, eventStore: f.eventStore, writeDelayMs: 5, onError: () => {} })
  try {
    await reads.ensure(f.peer)
    assert.deepEqual(reads.anchor(f.peer), newerAnchor)
    // Another device stored an older anchor under a newer event clock.
    push({ type: 'event', event: copy({ secret: f.secret, inner: second, context: emptyContext, coordinate: 'coord' }) })
    await until(() => f.writes.length === 1)
    assert.deepEqual(reads.anchor(f.peer), newerAnchor, 'the anchor itself never regresses')
    await reads.flush(f.peer)
    assert.equal(f.writes.length, 1)
    assert.deepEqual(f.writes[0].tags[1], ['anchor', newerAnchor.id, String(newerAnchor.created_at)])
  } finally { reads.close() }
})

test('a denied personal copy keeps the in-memory anchor and never breaks the reader', async () => {
  const f = readFixture()
  const errors = []
  const reads = createReadState({ pubkey: f.pubkey, signer, eventStore: f.eventStore, writeDelayMs: 5, onError: error => errors.push(error) })
  try {
    await reads.ensure(f.peer)
    f.setFail(true)
    reads.advance(f.peer, { id: hex('c'), created_at: 300 })
    await reads.flush(f.peer)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].message, 'READ_STATE_STORAGE_FAILED')
    assert.deepEqual(reads.anchor(f.peer), { id: hex('c'), created_at: 300 })
  } finally { reads.close() }
})

test('unread counter decrypts only peer messages newer than the anchor and caps at the badge limit', async () => {
  const secret = generateSecretKey()
  const pubkey = pubkeyOf(secret)
  const peer = pubkeyOf(generateSecretKey())
  const encodedContext = `root|${PERSONAL_COPY}|dm:${peer}`
  const wrappers = []
  for (let index = 0; index < 120; index++) {
    const mine = index % 3 === 0
    const inner = { kind: 9, created_at: 1000 + index, tags: [], content: `m${index}`, pubkey: mine ? pubkey : peer }
    wrappers.push(copy({ secret, inner, context: encodedContext, coordinate: `coord-${index}`, provenance: '1', created_at: inner.created_at }))
  }
  const eventStore = {
    async query (filter) {
      const results = wrappers.filter(wrapper =>
        filter['#c'].includes(wrapper.tags.find(tag => tag[0] === 'c')[1]) &&
        filter['#k'].includes(wrapper.tags.find(tag => tag[0] === 'k')[1]) &&
        (filter.since === undefined || wrapper.created_at >= filter.since) &&
        (filter.until === undefined || wrapper.created_at <= filter.until) &&
        !filter['!ids']?.includes(wrapper.id)
      ).sort((a, b) => b.created_at - a.created_at)
      return { results: results.slice(0, filter.limit) }
    }
  }
  const counter = createUnreadCounter({ pubkey, signer, eventStore })
  const anchorAt = createdAt => ({ id: '0'.repeat(64), created_at: createdAt })
  assert.equal(await counter.count(peer, anchorAt(1000)), 80)
  assert.equal(await counter.count(peer, anchorAt(1050)), 46)
  assert.equal(await counter.count(peer, anchorAt(2000)), 0)
  assert.equal(await counter.count(pubkey, null), 0, 'self chat never counts unread')
})

test('unread counter stops at the badge cap', async () => {
  const secret = generateSecretKey()
  const pubkey = pubkeyOf(secret)
  const peer = pubkeyOf(generateSecretKey())
  const encodedContext = `root|${PERSONAL_COPY}|dm:${peer}`
  const wrappers = Array.from({ length: 120 }, (_, index) => {
    const inner = { kind: 9, created_at: 1000 + index, tags: [], content: `m${index}`, pubkey: peer }
    return copy({ secret, inner, context: encodedContext, coordinate: `coord-${index}`, provenance: '1', created_at: inner.created_at })
  })
  const eventStore = {
    async query (filter) {
      const results = wrappers.filter(wrapper =>
        (filter.since === undefined || wrapper.created_at >= filter.since) &&
        (filter.until === undefined || wrapper.created_at <= filter.until) &&
        !filter['!ids']?.includes(wrapper.id)
      ).sort((a, b) => b.created_at - a.created_at)
      return { results: results.slice(0, filter.limit) }
    }
  }
  const counter = createUnreadCounter({ pubkey, signer, eventStore })
  assert.equal(await counter.count(peer, null), 100)
})

test('parser and winner selection stay stable for malformed or decorated tags', () => {
  const anchors = parseReadAnchors({
    tags: [
      ['anchor', hex('a'), '10', '~u=1'],
      ['anchor', 'not-hex', '11'],
      ['anchor', hex('b'), 'not-a-number'],
      ['anchor', hex('c'), '10'],
      ['d', '+zillion:read:peer']
    ]
  })
  assert.deepEqual(anchors, [{ id: hex('a'), created_at: 10 }, { id: hex('c'), created_at: 10 }])
  // Equal timestamps: the lower ID is the newest, matching chat ordering.
  assert.deepEqual(chooseReadAnchor(anchors), { id: hex('a'), created_at: 10 })
})

test('outgoing messages advance as soon as this session sees their publication confirm', () => {
  const outgoing = createOutgoingReads()
  const pending = { id: 'a'.repeat(64), created_at: 10, outgoing: true, status: 'pending' }
  const incoming = { id: 'b'.repeat(64), created_at: 11, outgoing: false, status: 'saved' }
  const historical = { id: 'c'.repeat(64), created_at: 12, outgoing: true, status: 'saved' }
  assert.deepEqual(outgoing.published([pending, incoming, historical]), [], 'pending and replayed history wait')
  assert.deepEqual(outgoing.published([{ ...pending, status: 'saved' }, incoming, historical]), [{ id: pending.id, created_at: 10 }])
  assert.deepEqual(outgoing.published([{ ...pending, status: 'saved' }, incoming, historical]), [], 'each confirmation advances once')
  const failed = { id: 'd'.repeat(64), created_at: 20, outgoing: true, status: 'error' }
  assert.deepEqual(outgoing.published([failed]), [], 'a failed publication never advances')
  assert.deepEqual(outgoing.published([{ ...failed, status: 'saved' }]), [{ id: failed.id, created_at: 20 }], 'a retry counts once published')
})
