import assert from 'node:assert/strict'
import { test } from 'node:test'
import { finalizeEvent } from 'libp2r2p/event'
import { getProfile, refreshProfile, selectPreferredProfile, eventToProfile } from '#helpers/nostr/queries.js'

const key = new Uint8Array(32).fill(1)
const event = finalizeEvent({ kind: 0, created_at: 10, tags: [], content: '{"name":"Alice","picture":"https://example.com/a.png"}' }, key)

test('profiles are read directly from the local event store', async () => {
  const profile = await getProfile(event.pubkey, {
    eventStore: {
      query: async filter => {
        assert.deepEqual(filter, { kinds: [0], authors: [event.pubkey], limit: 1 })
        return { results: [event] }
      }
    }
  })
  assert.equal(profile.name, 'Alice')
  assert.deepEqual(profile.meta.events, [event])
})

test('offline refresh never queries relays and online refresh persists the original signed event', async () => {
  let queries = 0
  let saved
  const options = {
    eventStore: { add: async value => { saved = value } },
    queryLatest: async () => { queries++; return { byPubkey: { [event.pubkey]: event } } }
  }
  assert.equal(await refreshProfile(event.pubkey, { ...options, checkOnline: async () => false }), null)
  assert.equal(queries, 0)
  const profile = await refreshProfile(event.pubkey, { ...options, checkOnline: async () => true })
  assert.equal(profile.name, 'Alice')
  assert.deepEqual(saved, event)
})

test('tampered metadata is rejected and stale refreshes do not replace newer local profiles', () => {
  assert.equal(eventToProfile({ ...event, content: '{"name":"Mallory"}' }), null)
  const newer = eventToProfile(finalizeEvent({ ...event, created_at: 11, content: '{"name":"New Alice"}' }, key))
  assert.equal(selectPreferredProfile(newer, eventToProfile(event)), newer)
  const a = { meta: { events: [{ kind: 0, created_at: 10, id: 'a' }] } }
  const b = { meta: { events: [{ kind: 0, created_at: 10, id: 'b' }] } }
  assert.equal(selectPreferredProfile(b, a), a)
})
