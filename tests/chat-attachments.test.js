import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareAttachment, verifyLocalFile } from '#services/chat-attachments.js'
import { decodeIrfsChunk } from 'libp2r2p/irfs'
import { nfileDecode } from 'libp2r2p/nip19'

test('unsupported preview formats remain sendable and preparation retains exact original bytes', async () => {
  const bytes = new Uint8Array(51001).fill(71)
  const file = new File([bytes], 'document.dat')
  const attachment = await prepareAttachment(file)
  assert.equal(attachment.metadata.mime, 'application/octet-stream')
  assert.equal(attachment.metadata.size, bytes.length)
  assert.equal(attachment.metadata.thumbhash, undefined)
  assert.equal(attachment.metadata.url.endsWith('?localOnly=1'), true)
  const reference = nfileDecode(new URL(attachment.metadata.url).pathname.slice(1))
  assert.deepEqual(reference, { root: attachment.prepared.root, relays: [], filename: file.name, mime: 'application/octet-stream' })
  const chunks = await Array.fromAsync(attachment.prepared.chunks())
  assert.deepEqual(new Uint8Array(chunks.flatMap(chunk => [...decodeIrfsChunk(chunk).contentBytes])), bytes)
  attachment.close()
  await assert.rejects(Array.fromAsync(attachment.prepared.chunks()))
})
test('empty files and canceled preparations fail explicitly; visual decoding failure does not fail the file', async () => {
  await assert.rejects(prepareAttachment(new File([], 'empty')), /EMPTY_IRFS_FILE/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(prepareAttachment(new File(['bytes'], 'data'), { signal: controller.signal }), { name: 'AbortError' })
  const attachment = await prepareAttachment(new File(['not an image'], 'bad.png', { type: 'image/png' }))
  assert.equal(attachment.metadata.width, undefined)
  assert.equal(attachment.metadata.size, 12)
  attachment.close()
})
test('local verification consumes a stream, rejects missing/truncated files and honors cancellation', async t => {
  const file = { url: 'https://nostr.alt/nfile1fixture?localOnly=1', size: 3 }
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    options.signal?.throwIfAborted()
    return new Response(Uint8Array.of(1, 2, 3))
  })
  await verifyLocalFile(file)
  await assert.rejects(verifyLocalFile({ ...file, size: 4 }), /INVALID_FILE_SIZE/)
  await assert.rejects(verifyLocalFile({ ...file, url: file.url.replace('nostr.alt', 'example.com') }), /INVALID_LOCAL_FILE/)
  await assert.rejects(verifyLocalFile(file, { signal: AbortSignal.abort() }), { name: 'AbortError' })
  globalThis.fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }))
  await assert.rejects(verifyLocalFile(file), /FILE_UNAVAILABLE/)
})
