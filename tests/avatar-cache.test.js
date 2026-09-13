import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { createQueue } from 'libp2r2p/idb-queue'
import { createMediaCache } from '#services/media-cache.js'
import { createAvatarCache } from '#services/avatar-cache.js'

test('avatar and media caches open separate databases with 16 and 64 MiB budgets', async () => {
  const indexedDB = new IDBFactory()
  const opened = []
  const openQueue = options => { opened.push(options); return createQueue({ ...options, indexedDB }) }
  const avatars = createAvatarCache({ openQueue })
  const media = createMediaCache({ openQueue })
  try {
    await avatars.get('https://example.com/picture.png')
    await media.get('https://example.com/picture.png')
    assert.deepEqual(opened.map(({ prefix, maxBytes, evictionPolicy }) => ({ prefix, maxBytes, evictionPolicy })), [
      { prefix: 'zillion:avatars:v1', maxBytes: 16 * 1024 * 1024, evictionPolicy: 'fifo' },
      { prefix: 'zillion:media:v1', maxBytes: 64 * 1024 * 1024, evictionPolicy: 'fifo' }
    ])
  } finally { await avatars.close(); await media.close() }
})

test('eviction and clearing stay isolated, and avatars reopen offline after media pressure', async () => {
  const indexedDB = new IDBFactory()
  let online = true
  let requests = 0
  const options = {
    openQueue: options => createQueue({ ...options, indexedDB }),
    maxBytes: 250,
    checkOnline: async () => online,
    fetchImage: async () => {
      requests++
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
    },
    decodeImage: async source => ({ source, width: 640, height: 480 })
  }
  let avatars = createAvatarCache(options)
  let media = createMediaCache(options)
  const url = 'https://example.com/picture.png'
  try {
    const image = await avatars.resolveImage(url)
    assert.equal(await media.get(url), null, 'identical URLs have independent entries')
    for (let i = 0; i < 6; i++) await media.resolveImage(`${url}?media=${i}`)
    assert.equal(await media.get(`${url}?media=0`), null, 'media budget was exceeded')
    await avatars.close()
    await media.close()
    online = false
    avatars = createAvatarCache(options)
    media = createMediaCache(options)
    const before = requests
    assert.deepEqual(await avatars.resolveImage(url), image, 'avatar survives pressure and reopens offline')
    assert.equal(requests, before)
    online = true
    for (let i = 0; i < 6; i++) await avatars.resolveImage(`${url}?avatar=${i}`)
    assert.equal(await avatars.get(url), null, 'avatar budget still evicts its own oldest entries')
    assert.deepEqual(await media.get(`${url}?media=5`), image, 'avatar eviction preserves media')
    await media.clear()
    assert.deepEqual(await avatars.get(`${url}?avatar=5`), image)
    await media.resolveImage(url)
    await avatars.clear()
    assert.deepEqual(await media.get(url), image)
  } finally { await avatars.close(); await media.close() }
})
