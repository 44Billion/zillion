import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSendFeedback } from '#helpers/send-feedback.js'
import { sendFailure, sendFailureMessages } from '#helpers/send-failure.js'
import locales from '../src/components/hooks/send-failure-locales.json' with { type: 'json' }

const publication = (...reasons) => ({ code: 'MESSAGE_NOT_PUBLISHED', reports: reasons.map(reason => ({ errors: [{ reason }] })) })

test('relay prefixes produce guidance without interpreting rejection prose as signer denial', () => {
  for (const [prefix, expected] of Object.entries({ blocked: 'access', restricted: 'access', 'auth-required': 'authentication', 'rate-limited': 'rate', pow: 'pow', invalid: 'invalid', mute: 'relay', error: 'relay', duplicate: 'publication' })) {
    assert.equal(sendFailure(publication(new Error(`${prefix}: PERMISSION_DENIED <b>details</b>`))), expected)
  }
  assert.equal(sendFailure(publication(new Error('blocked: one'), new Error('blocked: two'))), 'access')
  assert.equal(sendFailure(publication(new Error('blocked: one'), new Error('restricted: two'))), 'access')
  assert.equal(sendFailure(publication(new Error('blocked: one'), new Error('rate-limited: two'))), 'publication')
  assert.equal(sendFailure(publication(Object.assign(new Error('blocked: timed out'), { category: 'timeout' }))), 'connection')
  for (const reason of ['unknown: private detail', 'a reason mentioning blocked:', '', null]) assert.equal(sendFailure(publication(reason)), 'publication')
  assert.equal(sendFailure({ code: 'MESSAGE_NOT_PUBLISHED', reports: [{ errors: [] }, { errors: [{ reason: 'blocked: policy' }] }] }), 'publication')
  assert.equal(sendFailure({ code: 'MESSAGE_NOT_PUBLISHED', reason: 'NO_DELIVERY_REPORTS' }), 'publication')
})

test('local codes and all translations are explicit, with quiet cancellation and safe fallback', () => {
  for (const [code, expected] of Object.entries({ PERMISSION_DENIED: 'permission', VAULT_LOCKED: 'locked', READ_ONLY_ACCOUNT: 'readonly', READ_ONLY_TEMPORARY_ACCOUNT: 'readonly', CHAT_UNAVAILABLE: 'unavailable', FILE_UNAVAILABLE: 'file', MESSAGE_STORAGE_FAILED: 'storage', QUOTA_EXCEEDED: 'quota', PUBLISH_TIMEOUT: 'connection' })) {
    assert.equal(sendFailure(Object.assign(new Error('detail'), { code })), expected)
    assert.equal(sendFailure(new Error(code)), expected)
  }
  assert.equal(sendFailure(new DOMException('cancelled', 'AbortError')), null)
  assert.equal(sendFailure(new DOMException('disk', 'QuotaExceededError')), 'quota')
  assert.equal(sendFailure(new Error('unfamiliar problem')), 'generic')
  for (const key of Object.values(sendFailureMessages)) {
    assert.equal(locales[key].en, key)
    assert.deepEqual(Object.keys(locales[key]), ['en', 'fr', 'it', 'de', 'es', 'pt-BR', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko'])
    assert.ok(Object.values(locales[key]).every(value => typeof value === 'string' && value.length))
  }
})

function route () {
  const notices = []
  const state = { active: true, recipient: 'peer' }
  const feedback = createSendFeedback({ isActive: () => state.active, peer: () => state.recipient, notify: error => notices.push(error) })
  return { feedback, state, notices }
}
const error = new Error('failure')

test('only the originating route reports a user send once, including a new explicit retry', async () => {
  const a = route(); const b = route()
  a.feedback.send(() => 'message')
  const failed = () => { for (const r of [a, b]) r.feedback.failed(error, { id: 'message', peer: 'peer' }) }
  failed(); failed()
  assert.deepEqual(a.notices, [error]); assert.deepEqual(b.notices, [])
  await a.feedback.retry('message', async () => failed())
  assert.deepEqual(a.notices, [error, error])
  a.feedback.failed(error, { id: 'restored', peer: 'peer' })
  assert.equal(a.notices.length, 2, 'persisted and automatic failures are not UI intents')
})

test('inactive, evicted and successful attempts are discarded, never replayed on return', () => {
  const r = route()
  r.feedback.send(() => 'late')
  r.state.active = false
  r.feedback.failed(error, { id: 'late', peer: 'peer' })
  r.state.active = true
  r.feedback.failed(error, { id: 'late', peer: 'peer' })
  r.feedback.send(() => 'evicted'); r.feedback.clear()
  r.feedback.failed(error, { id: 'evicted', peer: 'peer' })
  r.feedback.send(() => 'saved'); r.feedback.reconcile([{ id: 'saved', status: 'saved' }])
  r.feedback.failed(error, { id: 'saved', peer: 'peer' })
  assert.deepEqual(r.notices, [])
})

test('immediate rejection preserves the draft and retry rejection cannot escape to an inactive route', async () => {
  const r = route()
  assert.equal(r.feedback.send(() => { throw error }), undefined)
  assert.deepEqual(r.notices, [error])
  r.notices.length = 0
  const work = Promise.withResolvers()
  const retry = r.feedback.retry('message', () => work.promise)
  r.state.active = false
  work.reject(error)
  await retry
  r.state.active = true
  r.feedback.failed(error, { id: 'message', peer: 'peer' })
  assert.deepEqual(r.notices, [])
})
