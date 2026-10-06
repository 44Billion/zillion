import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent } from 'libp2r2p/event'
import { createProfiles } from '#services/profiles.js'

const keys = Array.from({ length: 9 }, (_, n) => new Uint8Array(32).fill(n + 1))
const event = (index = 0, content = { name: 'Alice' }, at = 1) => finalizeEvent({ kind: 0, created_at: at, tags: [], content: JSON.stringify(content) }, keys[index])
const peers = keys.map((_, index) => event(index).pubkey)
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }
const response = (pubkey, profile, error, relay = 'wss://profiles.test') => ({
  byPubkey: profile ? { [pubkey]: profile } : {},
  requests: [{ phase: 'primary', authors: [pubkey], relays: [{ relay, status: error ? 'error' : 'eose', ...(error ? { error } : {}) }] }]
})
const temporary = (extra = {}) => Object.assign(new Error('rate-limited: busy'), { category: 'relay', ...extra })
function fixture (t, { query, local = [], persist, timeout } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const state = { online: true, reads: [], calls: [], saved: [], updates: [], subscriptions: 0, errors: [] }
  let wake
  let next
  let closed = false
  const stream = {
    [Symbol.asyncIterator] () { return this },
    next () { return closed ? Promise.resolve({ done: true }) : new Promise(resolve => { next = resolve }) },
    async return () { closed = true; next?.({ done: true }) }
  }
  const service = createProfiles({
    owner: peers[8], timeout,
    eventStore: {
      query: async filter => { state.reads.push(filter.authors[0]); return { results: local.filter(event => event.pubkey === filter.authors[0]) } },
      subscribe: () => { state.subscriptions++; return stream },
      add: async event => { state.saved.push(event); if (persist) return await persist(event) }
    },
    onProfile: (pubkey, profile) => state.updates.push({ pubkey, profile }),
    onError: error => state.errors.push(error),
    checkOnline: async () => state.online,
    watchOnline: handler => { wake = handler; return () => { wake = null } },
    queryLatest: async ([pubkey], options) => {
      state.calls.push({ pubkey, options })
      return query ? query(pubkey, options, state) : response(pubkey, event(peers.indexOf(pubkey)))
    }
  })
  t.after(() => service.close())
  return {
    ...state, state, service,
    online (value) { state.online = value; if (value) wake?.() },
    async advance (ms) { t.mock.timers.tick(ms); await flush() },
    push (event) { next?.({ value: { type: 'event', event }, done: false }) }
  }
}

test('contacts and avatars share local reads, network refresh, persistence and live updates', async t => {
  const f = fixture(t)
  const seen = []
  f.service.retain(peers[0], { onProfile: profile => seen.push(profile.name) })
  f.service.retain(peers[0], { remote: false })
  const third = f.service.retain(peers[0])
  await flush()
  assert.equal(f.reads.length, 1)
  assert.equal(f.calls.length, 1)
  assert.equal(f.saved.length, 1)
  assert.equal(f.state.subscriptions, 1)
  third.release()
  f.service.retain(peers[0])
  await flush()
  assert.equal(f.calls.length, 1)
  f.push(event(0, { name: 'Updated' }, 2))
  await flush()
  assert.deepEqual(seen, ['Alice', 'Updated'])
})

test('release cancels only the last remote consumer and a late response cannot leak after close', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { query: () => gate.promise })
  const a = f.service.retain(peers[0])
  const b = f.service.retain(peers[0])
  await flush()
  a.release()
  assert.equal(f.calls[0].options.signal.aborted, false)
  b.release()
  assert.equal(f.calls[0].options.signal.aborted, true)
  f.service.close()
  gate.resolve(response(peers[0], event()))
  await flush()
  assert.equal(f.updates.length, 0)
  assert.equal(f.saved.length, 0)
})

test('network has four shared slots while cached profiles do not wait for them', async t => {
  const gates = []
  const f = fixture(t, {
    local: [event(5, { name: 'Cached' })], query: pubkey => {
      const gate = Promise.withResolvers(); gates.push({ gate, pubkey }); return gate.promise
    }
  })
  for (const peer of peers.slice(0, 6)) f.service.retain(peer)
  await flush()
  assert.equal(f.calls.length, 4)
  assert.equal(f.reads.length, 6)
  assert.equal(f.updates.find(update => update.pubkey === peers[5]).profile.name, 'Cached')
  gates[0].gate.resolve(response(gates[0].pubkey, event(0)))
  await flush()
  assert.equal(f.calls.length, 5)
  f.service.close()
  for (const { gate, pubkey } of gates) gate.resolve(response(pubkey))
  await flush()
})

test('transient retries recover and consumers cannot bypass absolute retry_after', async t => {
  const f = fixture(t, {
    query: (pubkey, options, state) => state.calls.length === 1
      ? response(pubkey, null, temporary({ retryAt: 15000, retryAfterMs: 5000 }))
      : response(pubkey, event())
  })
  f.service.retain(peers[0])
  await flush()
  await f.advance(1000)
  f.service.retain(peers[0]); f.online(true)
  await flush()
  assert.equal(f.calls.length, 1)
  await f.advance(3999)
  assert.equal(f.calls.length, 1)
  await f.advance(1)
  assert.equal(f.calls.length, 2)
  assert.equal(f.updates.at(-1).profile.name, 'Alice')
})

test('offline failures consume no backoff and the shared online monitor resumes work', async t => {
  const f = fixture(t, {
    query: (pubkey, options, state) => {
      if (state.calls.length === 1) state.online = false
      return state.calls.length < 3 ? response(pubkey, null, temporary()) : response(pubkey, event())
    }
  })
  f.online(false)
  f.service.retain(peers[0])
  await flush()
  await f.advance(100000)
  assert.equal(f.calls.length, 0)
  f.online(true); await flush()
  assert.equal(f.calls.length, 1)
  await f.advance(100000)
  assert.equal(f.calls.length, 1)
  f.online(true); await flush()
  assert.equal(f.calls.length, 2)
  await f.advance(999)
  assert.equal(f.calls.length, 2)
  await f.advance(1)
  assert.equal(f.calls.length, 3, 'the first online failure still uses the one-second delay')
})

test('empty results retry slowly; successful profiles refresh only on stale demand', async t => {
  const f = fixture(t, { query: (pubkey, options, state) => response(pubkey, state.calls.length === 1 ? null : event(0, {})) })
  f.service.retain(peers[0])
  await flush()
  await f.advance(299999)
  assert.equal(f.calls.length, 1)
  await f.advance(1)
  assert.equal(f.calls.length, 2)
  assert.equal(f.saved.length, 1, 'a valid profile without a name is successful')
  await f.advance(300000)
  assert.equal(f.calls.length, 2, 'success has no periodic timer')
  f.service.retain(peers[0])
  await flush()
  assert.equal(f.calls.length, 3)
})

test('permanent and unknown refusals stay stopped across remounts and online notifications', async t => {
  const f = fixture(t, { query: pubkey => response(pubkey, null, Object.assign(new Error('blocked: private'), { category: 'relay' })) })
  const interest = f.service.retain(peers[0])
  await flush(); interest.release()
  await f.advance(600000)
  f.service.retain(peers[0]); f.online(true)
  await flush()
  assert.equal(f.calls.length, 1)
})

test('localOnly and own profiles never fetch; storage failures keep successful remote data', async t => {
  const f = fixture(t, { local: [event(1), event(8)], persist: () => { throw new Error('quota') } })
  f.service.retain(peers[1], { remote: false })
  f.service.retain(peers[8])
  f.service.retain(peers[0])
  await flush()
  assert.deepEqual(f.calls.map(call => call.pubkey), [peers[0]])
  assert.equal(f.updates.length, 3)
  assert.equal(f.errors.length, 1)
  await f.advance(300000)
  assert.equal(f.calls.length, 1)
})

test('a stale remote response never replaces a newer local profile', async t => {
  const f = fixture(t, { local: [event(0, { name: 'Newer' }, 10)] })
  f.service.retain(peers[0])
  await flush()
  assert.equal(f.updates.length, 1)
  assert.equal(f.updates[0].profile.name, 'Newer')
})

test('malformed profile content is retried slowly and never persisted', async t => {
  const f = fixture(t, { query: (pubkey, options, state) => response(pubkey, state.calls.length === 1 ? event(0, []) : event()) })
  f.service.retain(peers[0])
  await flush()
  assert.equal(f.saved.length, 0)
  await f.advance(300000)
  assert.equal(f.saved.length, 1)
  assert.equal(f.updates[0].profile.name, 'Alice')
})

test('an unknown relay error never enters automatic retry', async t => {
  const f = fixture(t, { query: pubkey => response(pubkey, null, new Error('unclassified failure')) })
  f.service.retain(peers[0]); await flush()
  await f.advance(600000); f.online(true); await flush()
  assert.equal(f.calls.length, 1)
})

test('ordering readiness uses cache immediately while remote freshness remains pending', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { local: [event(0)], query: () => gate.promise })
  const interest = f.service.retain(peers[0])
  let loaded = false
  interest.ready.then(() => { loaded = true })
  const profile = await interest.initialReady
  assert.equal(profile.name, 'Alice')
  await flush()
  assert.equal(loaded, false)
  assert.equal(f.calls.length, 1)
  gate.resolve(response(peers[0], event(0)))
  await interest.ready
})

test('slow persistence occupies no network slot and does not delay either readiness promise', async t => {
  const writes = []
  const f = fixture(t, { persist: () => { const write = Promise.withResolvers(); writes.push(write); return write.promise } })
  const interests = peers.slice(0, 6).map(peer => f.service.retain(peer))
  await Promise.all(interests.map(interest => interest.initialReady))
  await Promise.all(interests.map(interest => interest.ready))
  await flush()
  assert.equal(f.calls.length, 6)
  assert.equal(f.saved.length, 6)
  assert.equal(f.errors.length, 0)
  for (const write of writes) write.resolve({ ok: true })
})

test('quota result refusal is reported as storage failure without discarding a profile or retrying relays', async t => {
  const refusal = { ok: false, code: 'quota', message: 'Cache quota exceeded', stored: false }
  const f = fixture(t, { persist: () => refusal })
  const interest = f.service.retain(peers[0])
  assert.equal((await interest.initialReady).name, 'Alice')
  await flush()
  assert.equal(f.errors[0].code, 'quota')
  assert.equal(f.errors[0].cause, refusal)
  await f.advance(600000)
  assert.equal(f.calls.length, 1)
})

test('initial ordering readiness resolves on offline and failed first attempts', async t => {
  const f = fixture(t, { query: pubkey => response(pubkey, null, temporary()) })
  f.online(false)
  const offline = f.service.retain(peers[0])
  assert.equal(await offline.initialReady, null)
  f.online(true)
  await flush()
  const failed = f.service.retain(peers[1])
  assert.equal(await failed.initialReady, null)
  assert.equal(f.calls.length, 2)
})

for (const [label, profile] of [['empty', null], ['invalid', event(0, [])], ['nameless', event(0, {})]]) {
  test(`initial ordering readiness accepts a ${label} first lookup as complete`, async t => {
    const f = fixture(t, { query: pubkey => response(pubkey, profile) })
    const value = await f.service.retain(peers[0]).initialReady
    if (label === 'nameless') assert.equal(value.meta.events[0].id, profile.id)
    else assert.equal(value, null)
  })
}

test('local-only avatars observe the contact first attempt without extending network ownership', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { query: () => gate.promise })
  const contact = f.service.retain(peers[0])
  const states = []
  const avatar = f.service.retain(peers[0], { remote: false, onInitialState: state => states.push(state.pending) })
  assert.deepEqual(states, [true], 'initial state is notified synchronously')
  await flush()
  assert.deepEqual(states, [true], 'a local miss does not hide an existing contact query')
  assert.equal(f.reads.length, 1)
  assert.equal(f.calls.length, 1)
  assert.equal(await avatar.initialReady, null, 'the local-only promise contract stays local')
  contact.release()
  assert.equal(f.calls[0].options.signal.aborted, true, 'the avatar owns no remote work')
  assert.deepEqual(states, [true, false])
  gate.resolve(response(peers[0], event()))
  avatar.release()
})

test('first visual readiness settles on transient failure and stays settled through retries', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { query: (pubkey, options, state) => state.calls.length === 1 ? response(pubkey, null, temporary()) : gate.promise })
  const states = []
  f.service.retain(peers[0], { onInitialState: state => states.push(state.pending) })
  await flush()
  assert.deepEqual(states, [true, false])
  await f.advance(1000)
  f.service.retain(peers[0], { remote: false, onInitialState: state => states.push(state.pending) })
  assert.deepEqual(states, [true, false, false])
  gate.resolve(response(peers[0], event()))
  await flush()
  assert.deepEqual(states, [true, false, false])
})

test('known profiles settle visual readiness before remote refresh and slow storage', async t => {
  const gate = Promise.withResolvers()
  const f = fixture(t, { local: [event(0, {})], query: () => gate.promise })
  const states = []
  f.service.retain(peers[0], { remote: false, onInitialState: state => states.push(state.pending) })
  f.service.retain(peers[0])
  await flush()
  assert.deepEqual(states, [true, false], 'even a nameless profile with no picture is known')
  assert.equal(f.calls.length, 1)
  gate.resolve(response(peers[0], event()))
})

for (const outcome of ['empty', 'invalid', 'error', 'offline', 'local-only', 'own']) {
  test(`visual readiness ends on ${outcome} without starting independent avatar work`, async t => {
    const f = fixture(t, { query: pubkey => outcome === 'error' ? Promise.reject(new Error('failure')) : response(pubkey, outcome === 'invalid' ? event(0, []) : null) })
    if (outcome === 'offline') f.online(false)
    const pubkey = outcome === 'own' ? peers[8] : peers[0]
    const states = []
    const avatar = f.service.retain(pubkey, { remote: outcome !== 'local-only', onInitialState: state => states.push(state.pending) })
    await avatar.initialReady
    await flush()
    assert.deepEqual(states, [true, false])
    assert.equal(f.calls.length, ['offline', 'local-only', 'own'].includes(outcome) ? 0 : 1)
    avatar.release()
    await f.advance(300000)
    assert.deepEqual(states, [true, false], 'released callbacks are never invoked again')
  })
}
