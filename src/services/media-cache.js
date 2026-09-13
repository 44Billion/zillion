import { createQueue } from 'libp2r2p/idb-queue'
import { isOnline } from 'libp2r2p/network'
import { abortable, preparationSignal, prepareImage, mediaDimensions } from '#helpers/media-dimensions.js'
import { isDataAvatarPicture, isValidAvatarPicture } from '#helpers/avatar.js'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

// Data URLs make the queue's JSON byte accounting include the actual image payload.
async function imageDataUrl (response, signal) {
  const type = response.headers.get('content-type')?.split(';')[0]?.trim()
  const error = !response.ok || !/^image\/[a-z0-9.+-]+$/i.test(type || '')
    ? 'INVALID_IMAGE_RESPONSE'
    : Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES ? 'IMAGE_TOO_LARGE' : null
  if (error) {
    await response.body?.cancel().catch(() => {})
    throw new Error(error)
  }
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return `data:${type};base64,${btoa(binary)}`
}

// This cache is disposable; durable messages and Nostr events belong in eventStore.
export function createMediaCache ({
  openQueue = createQueue,
  checkOnline = isOnline,
  fetchImage = (...args) => fetch(...args),
  decodeImage = prepareImage,
  prefix = 'zillion:media:v1',
  maxBytes = 64 * 1024 * 1024
} = {}) {
  let queuePromise
  function queue () {
    queuePromise ??= openQueue({ prefix, maxBytes, evictionPolicy: 'fifo', indexes: { url: { keyPath: 'url', unique: true } } })
      .catch(error => { queuePromise = null; throw error })
    return queuePromise
  }

  async function get (url) {
    try {
      const record = await (await queue()).getBy('url', url)
      return record && mediaDimensions(record) ? { source: record.dataUrl, width: record.width, height: record.height } : null
    } catch { return null }
  }

  async function resolveImage (url, { signal } = {}) {
    if (!isValidAvatarPicture(url)) return null
    const requestSignal = preparationSignal(signal)
    const decode = async source => {
      const result = await abortable(decodeImage(source, { signal: requestSignal }), requestSignal)
      if (!mediaDimensions(result)) throw new Error('INVALID_IMAGE_DIMENSIONS')
      return result
    }
    try {
      requestSignal.throwIfAborted()
      if (isDataAvatarPicture(url)) return await decode(url)
      const cached = await abortable(get(url), requestSignal)
      if (cached) return cached
      if (!await abortable(checkOnline({ signal: requestSignal }), requestSignal)) return null
      let dataUrl
      try {
        const response = await abortable(fetchImage(url, {
          mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: requestSignal
        }), requestSignal)
        dataUrl = await abortable(imageDataUrl(response, requestSignal), requestSignal)
      } catch {
        requestSignal.throwIfAborted()
        // Native images may work despite CORS, but their bytes cannot be cached.
        if (globalThis.navigator?.onLine === false) return null
        return await decode(url)
      }
      const image = await decode(dataUrl)
      try {
        await abortable((await queue()).push({ url, dataUrl, width: image.width, height: image.height }), requestSignal)
      } catch { /* Storage denial, quota, or a duplicate must not prevent rendering. */ }
      requestSignal.throwIfAborted()
      return image
    } catch { return null }
  }

  async function clear () { await (await queue()).clear() }
  async function close () { if (queuePromise) await (await queuePromise).close(); queuePromise = null }
  return { get, resolveImage, clear, close }
}

export default createMediaCache()
