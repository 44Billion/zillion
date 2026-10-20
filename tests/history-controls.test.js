import assert from 'node:assert/strict'
import { test } from 'node:test'
import { controlHistoryPaging } from './browser/history-controls.js'

test('the viewport gate holds and coalesces requests, then releases exactly one real page', async () => {
  let calls = 0
  const work = Promise.withResolvers()
  const account = { loadOlder () { assert.equal(this, account); calls++; return work.promise } }
  const original = account.loadOlder
  const paging = controlHistoryPaging(account)
  assert.equal(await account.loadOlder(), false)
  assert.equal(calls, 0)
  paging.arm()
  const request = account.loadOlder()
  assert.equal(account.loadOlder(), request)
  assert.equal(paging.pending, true)
  const released = paging.release()
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.equal(paging.pending, false)
  work.resolve(true)
  assert.equal(await released, true)
  assert.equal(await request, true)
  assert.equal(await account.loadOlder(), false)
  assert.equal(calls, 1)
  paging.restore()
  assert.equal(account.loadOlder, original)
})

test('failed real pagination is reported rather than replaced with a successful page', async () => {
  const failure = new Error('page read failed')
  const account = { loadOlder: async () => { throw failure } }
  const paging = controlHistoryPaging(account)
  paging.arm()
  const request = account.loadOlder()
  const rejected = assert.rejects(request, error => error === failure)
  await assert.rejects(paging.release(), error => error === failure)
  await rejected
  paging.restore()
})

test('restoring the viewport gate cancels a held request without reading a page', async () => {
  let calls = 0
  const original = async () => { calls++; return true }
  const account = { loadOlder: original }
  const paging = controlHistoryPaging(account)
  paging.arm()
  const request = account.loadOlder()
  paging.restore()
  assert.equal(await request, false)
  assert.equal(calls, 0)
  assert.equal(await account.loadOlder(), true)
  assert.equal(calls, 1)
})
