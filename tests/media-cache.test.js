import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { createQueue } from 'libp2r2p/idb-queue'
import { createMediaCache } from '#services/media-cache.js'
import { mediaDimensions, mediaSizeStyle } from '#helpers/media-dimensions.js'
import { parseChatContent } from '#helpers/chat-content.js'

const url = 'https://example.com/avatar.png'
const decodeImage = async source => ({ source, width: 640, height: 480 })
const cachedImage = { source: 'data:image/png;base64,AQID', width: 640, height: 480 }
const imageResponse = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })

test('URL dimensions reserve a bounded aspect ratio and reject unusable values', () => {
  const media = parseChatContent('https://example.com/photo.jpg#dim=640x480')[0].url
  assert.deepEqual(mediaDimensions(media), { width: 640, height: 480 })
  assert.equal(mediaSizeStyle(media), 'width: 320px; aspect-ratio: 640 / 480;')
  assert.equal(mediaSizeStyle({ width: 100, height: 1000 }), 'width: 36px; aspect-ratio: 100 / 1000;')
  for (const width of [0, -1, Infinity, NaN, '', 'bad']) assert.equal(mediaDimensions({ width, height: 100 }), null)
})

test('invalid image bytes are not cached and cancellation during decoding returns no image', async () => {
  const indexedDB = new IDBFactory()
  const cache = createMediaCache({
    openQueue: options => createQueue({ ...options, indexedDB }),
    checkOnline: async () => true, fetchImage: imageResponse,
    decodeImage: async () => { throw new Error('Invalid image') }
  })
  assert.equal(await cache.resolveImage(url), null)
  assert.equal(await cache.get(url), null)
  await cache.close()
  const controller = new AbortController()
  const cancelled = createMediaCache({
    openQueue: async () => { throw new Error('denied') },
    checkOnline: async () => true, fetchImage: imageResponse,
    decodeImage: () => { controller.abort(); return new Promise(() => {}) }
  })
  assert.equal(await cancelled.resolveImage(url, { signal: controller.signal }), null)
})

test('image bytes survive reopening and render offline without any network check', async () => {
  const indexedDB = new IDBFactory()
  const options = { openQueue: options => createQueue({ ...options, indexedDB }) }
  const online = createMediaCache({ decodeImage, ...options, checkOnline: async () => true, fetchImage: imageResponse })
  const data = await online.resolveImage(url)
  assert.deepEqual(data, cachedImage)
  await online.close()
  let checks = 0
  const offline = createMediaCache({
    decodeImage,
    ...options,
    checkOnline: async () => { checks++; return false },
    fetchImage: () => { throw new Error('must not fetch offline') }
  })
  assert.deepEqual(await offline.resolveImage(url), data)
  assert.equal(checks, 0)
  assert.equal(await offline.resolveImage('https://example.com/missing.png'), null)
  assert.equal(checks, 1)
  await offline.close()
})

test('storage denial keeps downloaded bytes renderable and CORS failure keeps only the online URL', async () => {
  const cache = createMediaCache({
    decodeImage,
    openQueue: async () => { throw new Error('storage denied') },
    checkOnline: async () => true,
    fetchImage: imageResponse
  })
  assert.deepEqual(await cache.resolveImage(url), cachedImage)
  const cors = createMediaCache({
    decodeImage,
    openQueue: async () => { throw new Error('storage denied') },
    checkOnline: async () => true,
    fetchImage: async () => { throw new TypeError('CORS') }
  })
  assert.deepEqual(await cors.resolveImage(url), { source: url, width: 640, height: 480 })
})

test('oversized responses are not persisted and cancelled work cannot render a stale URL', async () => {
  const indexedDB = new IDBFactory()
  const controller = new AbortController()
  const cache = createMediaCache({
    decodeImage,
    openQueue: options => createQueue({ ...options, indexedDB }),
    checkOnline: async () => true,
    fetchImage: async () => new Response('', { headers: { 'content-type': 'image/png', 'content-length': 5 * 1024 * 1024 } })
  })
  assert.deepEqual(await cache.resolveImage(url), { source: url, width: 640, height: 480 })
  assert.equal(await cache.get(url), null)
  controller.abort()
  assert.equal(await cache.resolveImage(url, { signal: controller.signal }), null)
  await cache.close()
})

test('the byte budget evicts old images and allows offline misses to use a fallback', async () => {
  const indexedDB = new IDBFactory()
  let online = true
  const cache = createMediaCache({
    decodeImage,
    openQueue: options => createQueue({ ...options, indexedDB }),
    maxBytes: 250,
    checkOnline: async () => online,
    fetchImage: imageResponse
  })
  for (let i = 0; i < 6; i++) await cache.resolveImage(`${url}?${i}`)
  online = false
  assert.equal(await cache.resolveImage(`${url}?0`), null)
  assert.deepEqual(await cache.resolveImage(`${url}?5`), cachedImage)
  await cache.close()
})
