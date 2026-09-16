import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { rememberAttachmentPreview, acquireAttachmentPreview, acquireCachedAttachmentPreview } from '../../src/services/attachment-previews.js'
import { mediaSource } from '../../src/services/media-preparation/source.js'
import { pngPreview } from '../../src/services/media-preparation/png.js'
import { jpegDimensions, jpegDecodeSize } from '../../src/services/media-preparation/jpeg.js'
import { createMediaQueue } from '../../src/services/media-preparation/queue.js'
import { createUploadArtifact } from '../../src/services/media-preparation/artifact.js'

const fixture = async name => new Blob([await readFile(new URL(`../browser/fixtures/media/${name}`, import.meta.url))])

test('PNG rows preserve every legal color/depth layout through Adam7 and normal scanlines', async () => {
  for (const [type, depths] of [[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]) {
    for (const depth of depths) {
      const outputs = []
      for (const interlace of [0, 1]) {
        const source = await mediaSource(await fixture(`png-c${type}-d${depth}-i${interlace}.png`))
        const result = await pngPreview(source)
        assert.equal(result.width, 129)
        assert.equal(result.height, 97)
        const bytes = Buffer.from(await result.blob.arrayBuffer())
        const chunks = []
        for (let offset = 8; offset < bytes.length;) {
          const length = bytes.readUInt32BE(offset)
          if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
          offset += length + 12
        }
        outputs.push(inflateSync(Buffer.concat(chunks)))
      }
      assert.deepEqual(outputs[0], outputs[1], `${type}/${depth}: Adam7 must reconstruct identical pixels`)
    }
  }
})

test('PNG refuses malformed CRC and truncated bytes instead of silently accepting partial pixels', async () => {
  for (const name of ['png-bad-crc.png', 'png-truncated.png']) {
    await assert.rejects(pngPreview(await mediaSource(await fixture(name))))
  }
})

test('JPEG metadata keeps orientation, original dimensions and supported decode scale separate', async () => {
  for (let orientation = 1; orientation <= 8; orientation++) {
    const metadata = await jpegDimensions(await mediaSource(await fixture(`jpeg-orientation-${orientation}.jpg`)))
    assert.deepEqual([metadata.width, metadata.height, metadata.orientation], [192, 128, orientation])
  }
  assert.deepEqual(jpegDecodeSize({ width: 8192, height: 4096 }, 320), { desiredWidth: 1024, desiredHeight: 512 })
  assert.equal((await jpegDimensions(await mediaSource(await fixture('jpeg-s0-p1.jpg')))).progressive, true)
})

test('media queue serializes jobs and canceled waiters never start', async () => {
  const queue = createMediaQueue(); const controller = new AbortController()
  let release; let runs = 0
  const first = queue(() => new Promise(resolve => { release = resolve }))
  await Promise.resolve()
  await Promise.resolve()
  const second = queue(() => runs++, controller.signal)
  controller.abort()
  await assert.rejects(second, { name: 'AbortError' })
  release()
  await first
  await queue(() => runs++)
  assert.equal(runs, 1)
})

test('upload artifact preserves original bytes and identity with compression disabled', async () => {
  const original = new File(['original bytes'], 'file.txt', { type: 'text/plain' })
  const artifact = await createUploadArtifact(original, { compress: false })
  assert.equal(artifact.file, original)
  assert.equal(await artifact.file.text(), 'original bytes')
  await artifact.close()
  await artifact.close()
  assert.throws(() => artifact.file, { name: 'AbortError' })
})

test('local reader refuses unrelated URLs before fetching', async () => {
  await assert.rejects(mediaSource('https://example.com/file.png'), /INVALID_LOCAL_FILE/)
})

test('local range reader preserves localOnly and rejects oversized or incomplete bodies', async t => {
  const requests = []
  let mode = 'valid'
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options })
    if (options.method === 'HEAD') return new Response(null, { headers: { 'content-length': '8' } })
    const payload = mode === 'oversized' ? [1, 2, 3, 4] : mode === 'short' ? [1] : [1, 2, 3]
    return new Response(new Uint8Array(payload), { status: 206, headers: { 'content-range': mode === 'wrong' ? 'bytes 0-2/8' : 'bytes 2-4/8' } })
  })
  const reader = await mediaSource('https://nostr.alt/nfile1abc?localOnly=1#download=1')
  assert.deepEqual(await reader.read(2, 5), new Uint8Array([1, 2, 3]))
  assert.equal(requests[1].options.headers.Range, 'bytes=2-4')
  assert.equal(requests[1].url, 'https://nostr.alt/nfile1abc?localOnly=1')
  for (mode of ['oversized', 'short', 'wrong']) await assert.rejects(reader.read(2, 5), /INVALID_FILE_RANGE/)
})

test('cached thumbnails share a synchronous stable URL and leases survive replacement', async () => {
  const file = { root: 'test-cache-root', mime: 'image/png' }
  rememberAttachmentPreview(file, { blob: new Blob(['thumbnail']), width: 2, height: 3 })
  const controller = new AbortController()
  const first = acquireCachedAttachmentPreview(file, { signal: controller.signal })
  const second = await acquireAttachmentPreview(file)
  assert.equal(first.source, second.source)
  assert.deepEqual([first.width, first.height], [2, 3])
  controller.abort()
  assert.equal(first.closed, true)
  assert.equal(await (await fetch(second.source)).text(), 'thumbnail')
  second.close(); second.close()
  const third = acquireCachedAttachmentPreview(file)
  assert.equal(third.source, first.source, 'reopening requires no decode or new URL')
  rememberAttachmentPreview(file, { blob: new Blob(['replacement']), width: 4, height: 5 })
  const replacement = acquireCachedAttachmentPreview(file)
  assert.notEqual(replacement.source, third.source)
  assert.equal(await (await fetch(third.source)).text(), 'thumbnail', 'replacement cannot revoke active leases')
  third.close()
  await assert.rejects(fetch(third.source))
  replacement.close()
  assert.throws(() => acquireCachedAttachmentPreview(file, { signal: controller.signal }), { name: 'AbortError' })
})

test('thumbnail FIFO enforces entry and byte budgets without revoking active consumers', async () => {
  const file = { root: 'eviction-root', mime: 'image/png' }
  const preview = { blob: new Blob(['old']), width: 1, height: 1 }
  rememberAttachmentPreview(file, preview)
  const active = acquireCachedAttachmentPreview(file)
  for (let i = 0; i < 128; i++) rememberAttachmentPreview({ ...file, root: `evict-${i}` }, preview)
  assert.equal(acquireCachedAttachmentPreview(file), null)
  assert.equal(await (await fetch(active.source)).text(), 'old')
  active.close()
  await assert.rejects(fetch(active.source))
  rememberAttachmentPreview(file, preview)
  const inactive = acquireCachedAttachmentPreview(file)
  inactive.close()
  rememberAttachmentPreview({ ...file, root: 'full-budget' }, { ...preview, blob: new Blob([new Uint8Array(8 * 1024 * 1024)]) })
  assert.equal(acquireCachedAttachmentPreview(file), null)
  await assert.rejects(fetch(inactive.source))
})

test('cold preview work is shared and only canceled after the last interested consumer leaves', async t => {
  let requests = 0
  let currentSignal
  t.mock.method(globalThis, 'fetch', (url, { signal }) => {
    requests++
    currentSignal = signal
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  const file = { root: 'cold-cancel-root', mime: 'image/png', url: 'https://nostr.alt/nfile1abc?localOnly=1' }
  assert.equal(acquireCachedAttachmentPreview(file), null)
  const first = new AbortController(); const second = new AbortController()
  const one = acquireAttachmentPreview(file, { signal: first.signal })
  const two = acquireAttachmentPreview(file, { signal: second.signal })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests, 1)
  first.abort()
  await assert.rejects(one, { name: 'AbortError' })
  assert.equal(currentSignal.aborted, false)
  second.abort()
  await assert.rejects(two, { name: 'AbortError' })
  assert.equal(currentSignal.aborted, true)
  const third = new AbortController()
  const retry = acquireAttachmentPreview(file, { signal: third.signal })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests, 2, 'canceled preparation can be retried')
  third.abort()
  await assert.rejects(retry, { name: 'AbortError' })
})
