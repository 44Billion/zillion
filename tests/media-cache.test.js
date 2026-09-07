import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { createQueue } from 'libp2r2p/idb-queue'
import { createMediaCache } from '#services/media-cache.js'

const url = 'https://example.com/avatar.png'
const imageResponse = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })

test('image bytes survive reopening and render offline without any network check', async () => {
  const indexedDB = new IDBFactory()
  const options = { openQueue: options => createQueue({ ...options, indexedDB }) }
  const online = createMediaCache({ ...options, checkOnline: async () => true, fetchImage: imageResponse })
  const data = await online.resolveImage(url)
  assert.equal(data, 'data:image/png;base64,AQID')
  await online.close()
  let checks = 0
  const offline = createMediaCache({
    ...options,
    checkOnline: async () => { checks++; return false },
    fetchImage: () => { throw new Error('must not fetch offline') }
  })
  assert.equal(await offline.resolveImage(url), data)
  assert.equal(checks, 0)
  assert.equal(await offline.resolveImage('https://example.com/missing.png'), null)
  assert.equal(checks, 1)
  await offline.close()
})

test('storage denial keeps downloaded bytes renderable and CORS failure keeps only the online URL', async () => {
  const cache = createMediaCache({
    openQueue: async () => { throw new Error('storage denied') },
    checkOnline: async () => true,
    fetchImage: imageResponse
  })
  assert.equal(await cache.resolveImage(url), 'data:image/png;base64,AQID')
  const cors = createMediaCache({
    openQueue: async () => { throw new Error('storage denied') },
    checkOnline: async () => true,
    fetchImage: async () => { throw new TypeError('CORS') }
  })
  assert.equal(await cors.resolveImage(url), url)
})

test('oversized responses are not persisted and cancelled work cannot render a stale URL', async () => {
  const indexedDB = new IDBFactory()
  const controller = new AbortController()
  const cache = createMediaCache({
    openQueue: options => createQueue({ ...options, indexedDB }),
    checkOnline: async () => true,
    fetchImage: async () => new Response('', { headers: { 'content-type': 'image/png', 'content-length': 5 * 1024 * 1024 } })
  })
  assert.equal(await cache.resolveImage(url), url)
  assert.equal(await cache.get(url), null)
  controller.abort()
  assert.equal(await cache.resolveImage(url, { signal: controller.signal }), null)
  await cache.close()
})

test('the byte budget evicts old images and allows offline misses to use a fallback', async () => {
  const indexedDB = new IDBFactory()
  let online = true
  const cache = createMediaCache({
    openQueue: options => createQueue({ ...options, indexedDB }),
    maxBytes: 250,
    checkOnline: async () => online,
    fetchImage: imageResponse
  })
  for (let i = 0; i < 6; i++) await cache.resolveImage(`${url}?${i}`)
  online = false
  assert.equal(await cache.resolveImage(`${url}?0`), null)
  assert.equal(await cache.resolveImage(`${url}?5`), 'data:image/png;base64,AQID')
  await cache.close()
})
