import { prepareMediaPreview } from './media-preparation/index.js'

// Disposable local thumbnails, distinct from both HTTP media and avatar caches.
// Keep compressed small Blobs only; each consumer owns and revokes its URL.
const cache = new Map()
const pending = new Map()
const maxBytes = 8 * 1024 * 1024
let bytes = 0
const keyOf = file => file.root ? `${file.root}:${file.mime}` : `${file.url}:${file.mime}`

export function rememberAttachmentPreview (file, preview) {
  if (!preview?.blob || preview.blob.size > maxBytes) return
  const key = keyOf(file)
  bytes -= cache.get(key)?.blob.size || 0
  cache.delete(key)
  cache.set(key, preview)
  bytes += preview.blob.size
  while (bytes > maxBytes || cache.size > 128) {
    const oldest = cache.keys().next().value
    bytes -= cache.get(oldest).blob.size
    cache.delete(oldest)
  }
}

export async function acquireAttachmentPreview (file, { signal } = {}) {
  signal?.throwIfAborted()
  if (!/^(image|video)\//.test(file.mime)) return null
  const key = keyOf(file)
  let preview = cache.get(key)
  if (!preview) {
    let entry = pending.get(key)
    if (!entry) {
      const controller = new AbortController()
      entry = { controller, consumers: 0 }
      entry.work = prepareMediaPreview(file.url, file.mime, { signal: controller.signal }).then(value => {
        if (!controller.signal.aborted) rememberAttachmentPreview(file, value)
        return value
      }).finally(() => { if (pending.get(key) === entry) pending.delete(key) })
      pending.set(key, entry)
    }
    entry.consumers++
    const abort = () => {
      if (--entry.consumers === 0) {
        if (pending.get(key) === entry) pending.delete(key)
        entry.controller.abort()
      }
    }
    try {
      preview = await new Promise((resolve, reject) => {
        const canceled = () => reject(signal.reason)
        signal?.addEventListener('abort', canceled, { once: true })
        entry.work.then(resolve, reject).finally(() => signal?.removeEventListener('abort', canceled))
        if (signal?.aborted) canceled()
      })
    } finally { abort() }
  }
  signal?.throwIfAborted()
  if (!preview) return null
  const source = URL.createObjectURL(preview.blob)
  let closed = false
  const close = () => { if (!closed) { closed = true; URL.revokeObjectURL(source); signal?.removeEventListener('abort', close) } }
  signal?.addEventListener('abort', close, { once: true })
  return { source, width: preview.width, height: preview.height, close }
}
