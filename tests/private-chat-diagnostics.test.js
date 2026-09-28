import { test } from 'node:test'
import assert from 'node:assert/strict'
import { privateChatDiagnostic } from '#services/private-chat-diagnostics.js'

test('console diagnostics expose native aggregate causes and distinguish account instances', () => {
  const socket = Object.assign(new Error('socket closed'), { closeCode: 1006, wasClean: false })
  const reason = Object.assign(new Error('GET_EVENTS_TIMEOUT', { cause: socket }), { category: 'timeout' })
  const error = new AggregateError([reason], 'PRIVATE_CHANNEL_FETCH_INCOMPLETE')
  const a = privateChatDiagnostic(error, 'account-a')
  const b = privateChatDiagnostic(error, 'account-b')
  assert.equal(a.owner, 'account-a')
  assert.equal(b.owner, 'account-b')
  assert.equal(a.errors[0].category, 'timeout')
  assert.equal(a.errors[0].cause.closeCode, 1006)
  assert.equal(a.errors[0].cause.wasClean, false)
  assert.match(JSON.stringify(a), /GET_EVENTS_TIMEOUT/)
})

test('diagnostics retain read outcomes and publication reports without copying payload fields', () => {
  const reason = Object.assign(new Error('relay unavailable'), { category: 'connection', content: 'secret-body' })
  const error = Object.assign(new AggregateError([reason], 'PRIVATE_CHANNEL_FETCH_INCOMPLETE'), {
    code: 'PRIVATE_CHANNEL_FETCH_INCOMPLETE', operation: 'private-channel.fetch', receivedEventCount: 2, elapsedMs: 5010,
    request: { receiverPubkey: 'owner', channelPubkeys: ['channel'], relays: ['wss://example.test'], since: 10, until: 20, timeoutMs: 5000, signer: 'secret-signer' },
    relays: [{ relay: 'wss://example.test', status: 'timeout', error: reason, content: 'secret-report' }],
    relayErrors: [{ relay: 'wss://example.test', reason }],
    reports: [{ index: 0, total: 1, fulfilled: 0, errors: [{ relay: 'wss://example.test', reason }] }],
    event: { content: 'secret-message' }, deletionSeckey: 'secret-key'
  })
  const output = JSON.parse(JSON.stringify(privateChatDiagnostic(error, 'owner')))
  assert.equal(output.request.since, 10)
  assert.equal(output.relays[0].status, 'timeout')
  assert.equal(output.relayErrors[0].reason.message, 'relay unavailable')
  assert.equal(output.reports[0].errors[0].reason.category, 'connection')
  assert.doesNotMatch(JSON.stringify(output), /secret-/)
  assert.equal(error.errors[0], reason)
})

test('diagnostics handle cyclic causes, empty aggregates and non-Error throws', () => {
  const error = new Error('cycle')
  error.cause = error
  assert.equal(privateChatDiagnostic(error, 'owner').cause.truncated, 'circular')
  assert.deepEqual(privateChatDiagnostic(new AggregateError([], 'incomplete'), 'owner').errors, [])
  assert.equal(privateChatDiagnostic('failed', 'owner').message, 'failed')
})

test('subscription diagnostics expose the relay URL and operation alongside native close details', () => {
  const native = Object.assign(new Error('CONNECTION_CLOSED'), { category: 'transport', closeCode: 1006, closeReason: '', wasClean: false })
  const contextual = Object.assign(new Error(native.message, { cause: native }), {
    category: native.category, closeCode: native.closeCode, closeReason: native.closeReason, wasClean: native.wasClean,
    relay: 'wss://relay.44billion.net', operation: 'private-channel.subscribe'
  })
  const output = JSON.parse(JSON.stringify(privateChatDiagnostic(contextual, 'owner')))
  assert.equal(output.relay, 'wss://relay.44billion.net')
  assert.equal(output.operation, 'private-channel.subscribe')
  assert.equal(output.message, 'CONNECTION_CLOSED')
  assert.equal(output.closeCode, 1006)
  assert.equal(output.wasClean, false)
  assert.equal(output.cause.message, native.message)
  assert.equal(output.cause.category, native.category)
})
