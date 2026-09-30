import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFileMetadata } from 'libp2r2p/nip94'
import { nfileEncode } from 'libp2r2p/nip19'
import { prefetchChatMedia } from '#services/chat-media-prefetch.js'
import { attachmentPlaceholder } from '#helpers/attachment-placeholder.js'
import { rgbaToThumbHash } from 'thumbhash'
import { bytesToBase64 } from 'libp2r2p/base64'

const hash = bytesToBase64(rgbaToThumbHash(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])))
function fixture (count = 10) {
  const files = new Map()
  const messages = Array.from({ length: count }, (_, index) => {
    const id = String(index + 1).padStart(64, '0')
    const mime = index === 6 ? 'application/pdf' : index === 7 ? 'audio/ogg' : index % 2 ? 'video/webm' : 'image/png'
    files.set(id, { ...createFileMetadata({ root: id, url: `https://nostr.alt/${nfileEncode({ root: id, mime })}`, mime, service: 'irfs' }), id })
    return { id, kind: 9, created_at: index, tags: [['q', id]], content: '' }
  })
  return { files, messages, resolve: reference => files.get(reference.id) }
}

test('five unique local image/video previews, newest first, skip misses and other file types', async () => {
  const f = fixture()
  f.messages.push({ ...f.messages.at(-1), created_at: 11 })
  const calls = []; let closed = 0
  const count = await prefetchChatMedia(f.messages, f.resolve, {
    prepare: async (file, options) => {
      assert.equal(options.localOnly, true)
      calls.push(Number(file.root))
      if (Number(file.root) === 9) return null
      return { close: () => closed++ }
    }
  })
  assert.deepEqual(calls, [10, 9, 6, 5, 4, 3])
  assert.equal(count, 5)
  assert.equal(closed, 5)
})

test('thumbhashes need no file reads; absent dimensions use their aspect ratio', async () => {
  const f = fixture(1)
  f.files.get(f.messages[0].id).tags.push(['thumbhash', hash])
  assert.equal(await prefetchChatMedia(f.messages, f.resolve, { prepare: () => assert.fail('hash must not read the original') }), 1)
  const placeholder = attachmentPlaceholder({ thumbhash: hash })
  assert.match(placeholder.source, /^data:image\/png;base64,/)
  assert.ok(placeholder.width > placeholder.height)
  assert.equal(attachmentPlaceholder({ thumbhash: 'invalid' }), null)
})

test('prefetch stops at the first page and never reads external media', async () => {
  const f = fixture(30)
  for (const [id, event] of f.files) if (Number(id) > 5) event.tags = event.tags.map(tag => tag[0] === 'url' ? ['url', 'https://example.com/photo.png'] : tag)
  assert.equal(await prefetchChatMedia(f.messages, f.resolve, { prepare: () => assert.fail('older page and external URLs must be excluded') }), 0)
})

test('cancelled preparation releases the current lease and never starts another file', async () => {
  const f = fixture(4)
  const controller = new AbortController()
  let calls = 0; let closed = 0
  await assert.rejects(prefetchChatMedia(f.messages, f.resolve, {
    signal: controller.signal,
    prepare: async () => { calls++; controller.abort(); return { close: () => closed++ } }
  }), { name: 'AbortError' })
  assert.equal(calls, 1)
  assert.equal(closed, 1)
})
