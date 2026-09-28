import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertMessagePublished } from '#services/message-publication.js'

const event = { kind: 9, created_at: 100, pubkey: 'a'.repeat(64), tags: [], content: 'private message' }

test('one accepting relay per outer event succeeds without awaiting slower relays', async () => {
  const pending = new Promise(() => {})
  await assertMessagePublished({
    delivery: {
      reports: [
        { success: true, total: 2, promise: pending },
        { success: true, total: 2, promise: pending }
      ]
    }
  }, event)
})

test('partial publication fails with only the failed outer event diagnostics', async () => {
  const reason = Object.assign(new Error('auth-required: authenticate first'), { category: 'protocol', code: 'AUTH_REQUIRED' })
  const result = {
    rumor: event, delivery: {
      deletionSeckey: 'secret deletion key', reports: [
        { success: true, promise: new Promise(() => {}) },
        { success: false, total: 2, promise: Promise.resolve({ total: 2, fulfilled: 0, errors: [{ relay: 'wss://relay.test', reason }], extra: 'secret extra' }) }
      ]
    }
  }
  await assert.rejects(assertMessagePublished(result, event), error => {
    assert.equal(error.reason, 'RELAY_PUBLICATION_FAILED')
    assert.deepEqual(error.reports, [{ index: 1, total: 2, fulfilled: 0, errors: [{ relay: 'wss://relay.test', reason }] }])
    assert.match(error.message, /report 2 \(2 relays\).*auth-required/)
    assert.equal(error.reports[0].errors[0].reason, reason)
    assert.doesNotMatch(JSON.stringify(error), /private message|secret deletion key|secret extra/)
    assert.doesNotMatch(error.message, /private message|secret deletion key/)
    return true
  })
})

test('missing reports and an empty relay set have distinct diagnostics', async () => {
  for (const result of [undefined, {}, { delivery: { reports: [] } }]) {
    await assert.rejects(assertMessagePublished(result, event), { code: 'MESSAGE_NOT_PUBLISHED', reason: 'NO_DELIVERY_REPORTS' })
  }
  await assert.rejects(assertMessagePublished({ delivery: { reports: [{ success: false, total: 0, promise: Promise.resolve({ total: 0, fulfilled: 0, errors: [] }) }] } }, event), /NO_RELAYS/)
})

test('absent or rejected detailed reports preserve the publication failure', async () => {
  await assert.rejects(assertMessagePublished({ delivery: { reports: [{ success: false }] } }, event), /NO_RELAY_ACKNOWLEDGEMENT/)
  const promise = Promise.reject(new Error('report unavailable'))
  await assert.rejects(assertMessagePublished({ delivery: { reports: [{ success: false, total: 2, promise }] } }, event), /report unavailable/)
})
