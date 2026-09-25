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

function fixture ({ owner, event, eventAfter = Infinity }) {
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
    _retryDelays: [1]
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
