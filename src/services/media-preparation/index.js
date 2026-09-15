import { rgbaToThumbHash } from 'thumbhash'
import { bytesToBase64 } from 'libp2r2p/base64'
import { mediaSource } from './source.js'
import { queueMedia } from './queue.js'

// Local preparation is cancellable, not subject to the HTTP preview's 15s
// deadline. A stalled decoder is still bounded by a two-minute watchdog.
export function prepareMediaPreview (input, mime, { signal, onProgress } = {}) {
  if (!/^(image|video)\//.test(mime)) return Promise.resolve(null)
  const current = AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])])
  return queueMedia(async () => {
    onProgress?.({ phase: 'preview' })
    const source = await mediaSource(input, { signal: current })
    const result = mime.startsWith('image/')
      ? await (await import('./image.js')).imagePreview(source, mime, { signal: current })
      : await (await import('./video.js')).videoPreview(source, { signal: current, input })
    current.throwIfAborted()
    const thumbhash = bytesToBase64(rgbaToThumbHash(result.hashWidth, result.hashHeight, result.pixels))
    return { blob: result.blob, width: result.width, height: result.height, thumbhash, backend: result.backend }
  }, current)
}
