import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync, inflateSync, crc32 } from 'node:zlib'
import { compressionDimensions, compressedName } from '../../src/services/media-preparation/dimensions.js'
import { pngPreview } from '../../src/services/media-preparation/png.js'
import { mediaSource } from '../../src/services/media-preparation/source.js'

test('compression breakpoints use the shorter display side and never upscale', () => {
  for (const shorter of [1, 479, 480, 481, 719, 720, 721, 1079, 1080, 1081, 2160]) {
    const target = Math.min(shorter, shorter >= 1080 ? 1080 : shorter >= 720 ? 720 : 480)
    assert.deepEqual(compressionDimensions(shorter * 2, shorter), { width: target * 2, height: target })
    assert.deepEqual(compressionDimensions(shorter, shorter * 2), { width: target, height: target * 2 })
    assert.deepEqual(compressionDimensions(shorter, shorter), { width: target, height: target })
  }
  assert.deepEqual(compressionDimensions(3840, 2160), { width: 1920, height: 1080 })
  assert.deepEqual(compressionDimensions(4000, 3000), { width: 1440, height: 1080 })
  assert.deepEqual(compressionDimensions(1600, 900), { width: 1280, height: 720 })
  assert.deepEqual(compressionDimensions(901, 1601, { even: true }), { width: 720, height: 1278 })
  for (const pair of [[0, 1], [NaN, 2], [Infinity, 2], [1, -1], [1e8, 480]]) assert.throws(() => compressionDimensions(...pair))
  assert.throws(() => compressionDimensions(1, 2000, { even: true }))
  assert.equal(compressedName('férias.original.png', 'webp'), 'férias.original.webp')
})

test('compression PNG reduction averages linear light, separately from the thumbnail path', async () => {
  const chunk = (type, data) => {
    const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8)
    result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4); return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2
  const blob = new Blob([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))])
  const sample = async linear => {
    const reduced = await pngPreview(await mediaSource(blob), undefined, 1, { linear })
    const bytes = Buffer.from(await reduced.blob.arrayBuffer())
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset)
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') return inflateSync(bytes.subarray(offset + 8, offset + 8 + length))[1]
      offset += length + 12
    }
  }
  assert.equal(await sample(false), 128)
  assert.equal(await sample(true), 188)
})
