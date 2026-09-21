import { prepareMediaPreview } from './media-preparation/index.js'

// Disposable small previews. A resident entry owns one stable URL; leases keep
// retired entries alive until their last consumer releases them.
const cache = new Map()
const pending = new Map()
const maxBytes = 8 * 1024 * 1024
let bytes = 0
const keyOf = file => file.root ? `${file.root}:${file.mime}` : `${file.url}:${file.mime}`
const release = entry => {
  if (!entry.cached && !entry.consumers && entry.source) {
    URL.revokeObjectURL(entry.source)
    entry.source = null
  }
}
const retire = key => {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  bytes -= entry.preview.blob.size
  entry.cached = false
  release(entry)
}

export function rememberAttachmentPreview (file, preview) {
  if (!preview?.blob) return null
  const entry = { preview, source: null, consumers: 0, cached: false }
  if (preview.blob.size > maxBytes) return entry
  const key = keyOf(file)
  retire(key)
  entry.cached = true
  cache.set(key, entry)
  bytes += preview.blob.size
  for (const key of cache.keys()) {
    if (bytes <= maxBytes && cache.size <= 128) break
    retire(key)
  }
  return entry
}

function acquire (entry, signal) {
  signal?.throwIfAborted()
  if (!entry) return null
  entry.source ||= URL.createObjectURL(entry.preview.blob)
  entry.consumers++
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', close)
    entry.consumers--
    release(entry)
  }
  signal?.addEventListener('abort', close, { once: true })
  return { source: entry.source, width: entry.preview.width, height: entry.preview.height, animated: entry.preview.animated === true, close, get closed () { return closed } }
}

export function acquireCachedAttachmentPreview (file, { signal } = {}) {
  return acquire(cache.get(keyOf(file)), signal)
}

export async function acquireAttachmentPreview (file, { signal } = {}) {
  signal?.throwIfAborted()
  if (!/^(image|video)\//.test(file.mime)) return null
  const cached = acquireCachedAttachmentPreview(file, { signal })
  if (cached) return cached
  const key = keyOf(file)
  let entry = pending.get(key)
  if (!entry) {
    const controller = new AbortController()
    entry = { controller, consumers: 0 }
    entry.work = prepareMediaPreview(file.url, file.mime, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) return rememberAttachmentPreview(file, value)
      return null
    }).finally(() => { if (pending.get(key) === entry) pending.delete(key) })
    pending.set(key, entry)
  }
  entry.consumers++
  try {
    const preview = await new Promise((resolve, reject) => {
      const canceled = () => reject(signal.reason)
      signal?.addEventListener('abort', canceled, { once: true })
      entry.work.then(resolve, reject).finally(() => signal?.removeEventListener('abort', canceled))
      if (signal?.aborted) canceled()
    })
    return acquire(preview, signal)
  } finally {
    if (--entry.consumers === 0) {
      if (pending.get(key) === entry) pending.delete(key)
      entry.controller.abort()
    }
  }
}
