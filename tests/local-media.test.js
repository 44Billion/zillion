import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareIrfsFile } from 'libp2r2p/irfs'
import { createEventStoreChunkStorage } from 'libp2r2p/private-messenger/event-store'
import { createLocalMediaAccess } from '#services/local-media.js'

async function fixture (t) {
  const prepared = await prepareIrfsFile(new Uint8Array(51001).fill(7))
  const chunks = await Array.fromAsync(prepared.chunks())
  const stored = new Map(chunks.map(chunk => [chunk.tags.find(tag => tag[0] === 'd')[1], chunk]))
  let reads = 0
  let gate = async () => {}
  const storage = createEventStoreChunkStorage({
    eventStore: {
      async query (filter) { reads++; await gate(); const chunk = stored.get(filter['#d'][0]); return { results: chunk ? [chunk] : [] } },
      async addPersonalCopy () { assert.fail('availability must not write storage') }
    }
  })
  const local = createLocalMediaAccess(storage)
  t.after(() => { local.close(); prepared.close() })
  return { local, stored, chunks, file: { root: prepared.root, size: prepared.size }, reads: () => reads, hold: value => { gate = value } }
}

test('local original consumers share one verified read and reuse completed descriptors', async t => {
  const f = await fixture(t)
  assert.deepEqual(await Promise.all([f.local.check(f.file), f.local.check(f.file)]), [true, true])
  assert.equal(f.reads(), 2)
  assert.equal(await f.local.check(f.file), true)
  assert.equal(f.reads(), 2, 'a click reuses the completed check from the bubble')
  assert.equal(await f.local.check({ ...f.file, size: undefined }), true)
  await assert.rejects(f.local.check({ ...f.file, size: 51002 }), /FILE_SIZE_MISMATCH/, 'a conflicting size cannot reuse a verified descriptor')
})

test('missing chunks stay missing, while malformed data and storage failures remain errors', async t => {
  const f = await fixture(t)
  const last = f.chunks[1].tags.find(tag => tag[0] === 'd')[1]
  f.stored.delete(last)
  assert.equal(await f.local.check(f.file), false)
  f.stored.set(last, { ...f.chunks[1], content: '' })
  await assert.rejects(f.local.check(f.file), /INVALID_IRFS_CHUNK/)
  f.stored.set(last, f.chunks[1])
  f.hold(async () => { throw new Error('STORAGE_DENIED') })
  await assert.rejects(f.local.check(f.file), /STORAGE_DENIED/)
  f.hold(async () => {})
  assert.equal(await f.local.check(f.file), true, 'failures are not cached as availability')
})

test('a consumer leaving does not cancel another local reader, and close aborts pending work', async t => {
  const f = await fixture(t)
  const entered = Promise.withResolvers()
  const held = Promise.withResolvers()
  t.after(() => held.resolve())
  f.hold(() => { entered.resolve(); return held.promise })
  const controller = new AbortController()
  const first = f.local.check(f.file, { signal: controller.signal })
  const second = f.local.check(f.file)
  await entered.promise
  controller.abort()
  await assert.rejects(first, { name: 'AbortError' })
  held.resolve()
  assert.equal(await second, true)
  assert.equal(f.reads(), 2)
  const pending = f.local.check({ ...f.file, size: undefined })
  f.local.close()
  await assert.rejects(pending, { name: 'AbortError' })
})
