import { createQueue } from 'libp2r2p/idb-queue'
import { isOnline } from 'libp2r2p/network'
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
    try { return (await (await queue()).getBy('url', url))?.dataUrl ?? null } catch { return null }
  }

  async function resolveImage (url, { signal } = {}) {
    if (!isValidAvatarPicture(url)) return null
    if (isDataAvatarPicture(url)) return url
    const cached = await get(url)
    if (signal?.aborted) return null
    if (cached) return cached
    try {
      if (!await checkOnline({ signal })) return null
      const requestSignal = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])
      const response = await fetchImage(url, {
        mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: requestSignal
      })
      const dataUrl = await imageDataUrl(response, requestSignal)
      if (signal?.aborted) return null
      try {
        // The unique index also resolves concurrent downloads of the same URL.
        await (await queue()).push({ url, dataUrl })
      } catch { /* Storage denial, quota, or a duplicate must not prevent rendering. */ }
      return dataUrl
    } catch {
      if (signal?.aborted || globalThis.navigator?.onLine === false) return null
      // CORS can prevent fetching bytes while a native image remains displayable online.
      return await checkOnline({ signal }).catch(() => false) ? url : null
    }
  }

  async function clear () { await (await queue()).clear() }
  async function close () { if (queuePromise) await (await queuePromise).close(); queuePromise = null }
  return { get, resolveImage, clear, close }
}

export default createMediaCache()
