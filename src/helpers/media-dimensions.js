export function mediaDimensions (value) {
  const width = Number(value?.width)
  const height = Number(value?.height)
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : null
}

export function mediaSizeStyle (value, maxHeight = 360) {
  const dimensions = mediaDimensions(value)
  if (!dimensions) return ''
  const { width, height } = dimensions
  return `width: ${Math.min(320, maxHeight * width / height)}px; aspect-ratio: ${width} / ${height};`
}

// Race even APIs that do not accept AbortSignal (decoding and IndexedDB).
export function abortable (promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

export function preparationSignal (signal) {
  return AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])
}

export async function prepareImage (source, { signal }) {
  const image = new Image()
  image.referrerPolicy = 'no-referrer'
  image.src = source
  try {
    await abortable(image.decode(), signal)
    const dimensions = mediaDimensions({ width: image.naturalWidth, height: image.naturalHeight })
    if (!dimensions) throw new Error('INVALID_IMAGE_DIMENSIONS')
    return { source, ...dimensions }
  } finally { image.removeAttribute('src') }
}

export async function prepareVideo (source, { signal, dimensions } = {}) {
  if (mediaDimensions(dimensions)) return { source, ...mediaDimensions(dimensions) }
  const video = document.createElement('video')
  video.preload = 'metadata'
  try {
    await abortable(new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('INVALID_VIDEO'))
      video.src = source
    }), signal)
    const size = mediaDimensions({ width: video.videoWidth, height: video.videoHeight })
    if (!size) throw new Error('INVALID_VIDEO_DIMENSIONS')
    return { source, ...size }
  } finally {
    video.onloadedmetadata = video.onerror = null
    video.removeAttribute('src')
    video.load()
  }
}
