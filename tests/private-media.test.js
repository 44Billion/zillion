import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachPrivateMediaTransport, ensurePrivateMedia, mediaState, observePrivateMedia, reportPrivateMedia } from '#services/private-media.js'

const file = { peer: 'b'.repeat(64), root: 'c'.repeat(64), size: 123 }

test('retry clears a pre-transfer failure and completes a cached file without notifications', async t => {
  let fail = true
  const states = []
  t.after(attachPrivateMediaTransport({ download: async () => { if (fail) throw new Error('STORAGE_UNAVAILABLE'); return file } }))
  t.after(observePrivateMedia(state => states.push(state.status)))
  await assert.rejects(ensurePrivateMedia(file), /STORAGE_UNAVAILABLE/)
  assert.equal(mediaState(file).status, 'error')
  fail = false
  assert.deepEqual(await ensurePrivateMedia(file, { manual: true }), file)
  assert.deepEqual(states, ['checking', 'error', 'checking', 'complete'])
})

test('missing oversized originals remain actionable, then complete on manual retry', async t => {
  t.after(attachPrivateMediaTransport({ download: async (_, { manual }) => { if (!manual) throw new Error('FILE_DOWNLOAD_REQUIRES_ACTION'); return file } }))
  await assert.rejects(ensurePrivateMedia(file), /FILE_DOWNLOAD_REQUIRES_ACTION/)
  assert.equal(mediaState(file).status, 'idle')
  await ensurePrivateMedia(file, { manual: true })
  assert.equal(mediaState(file).status, 'complete')
})

test('a cancelled consumer cannot overwrite a shared transfer with completion or error', async t => {
  const held = Promise.withResolvers()
  const controller = new AbortController()
  t.after(attachPrivateMediaTransport({ download: () => held.promise }))
  const request = ensurePrivateMedia(file, { signal: controller.signal })
  controller.abort()
  reportPrivateMedia({ ...file, status: 'downloading', completed: 10 })
  held.resolve(file)
  await assert.rejects(request, { name: 'AbortError' })
  assert.equal(mediaState(file).status, 'downloading')
})

test('speculative availability checks use only local storage without transfer states', async t => {
  const { checkLocalPrivateMedia } = await import('#services/private-media.js')
  const states = []
  let available = false
  t.after(attachPrivateMediaTransport({ checkLocal: async () => available, download: () => assert.fail('local preparation must not download') }))
  t.after(observePrivateMedia(state => states.push(state)))
  assert.equal(await checkLocalPrivateMedia(file), false)
  available = true
  assert.equal(await checkLocalPrivateMedia(file), true)
  assert.deepEqual(states, [])
  const controller = new AbortController(); controller.abort()
  await assert.rejects(checkLocalPrivateMedia(file, { signal: controller.signal }), { name: 'AbortError' })
})
