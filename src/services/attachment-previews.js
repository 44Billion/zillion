import { mediaDimensions } from '#helpers/media-dimensions.js'
import { checkLocalPrivateMedia, ensurePrivateMedia } from './private-media.js'
import { nfileDecode } from 'libp2r2p/nip19'
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

// Read dimensions without allocating a URL/lease. A freshly mounted bubble can
// reserve its final geometry before any visibility task or decoder runs.
export const attachmentPreviewDimensions = file => mediaDimensions(cache.get(keyOf(file))?.preview)

export function localAttachmentUrl (file) {
  try {
    const url = new URL(file.url)
    if (url.origin !== 'https://nostr.alt' || nfileDecode(url.pathname.slice(1)).root !== file.root) return null
    url.search = '?localOnly=1'; url.hash = ''
    return url.href
  } catch { return null }
}

export async function acquireAttachmentPreview (file, { signal, localOnly = false } = {}) {
  signal?.throwIfAborted()
  if (!/^(image|video)\//.test(file.mime)) return null
  if (localOnly && !localAttachmentUrl(file)) return null
  if (!localOnly) {
    const cached = acquireCachedAttachmentPreview(file, { signal })
    if (cached) return cached
  }
  const key = keyOf(file)
  // A foreground reader can share speculative work. Local-only readers must
  // never join a normal preparation that may request missing remote bytes.
  const pendingKey = localOnly || pending.has(`${key}:local`) ? `${key}:local` : key
  let entry = pending.get(pendingKey)
  if (!entry) {
    const controller = new AbortController()
    entry = { controller, consumers: 0 }
    entry.work = (async () => {
      if (cache.has(key)) return cache.get(key)
      const thumb = file.thumbnail
      const useThumb = thumb?.root && (!localOnly || (localAttachmentUrl(thumb) && await checkLocalPrivateMedia(thumb, { signal: controller.signal })))
      let preview
      if (useThumb) {
        if (!localOnly) await ensurePrivateMedia({ ...thumb, peer: file.peer, sharedAt: file.sharedAt }, { thumbnail: true, signal: controller.signal })
        const mime = nfileDecode(new URL(thumb.url).pathname.slice(1)).mime || 'image/png'
        const prepared = await prepareMediaPreview(localOnly ? localAttachmentUrl(thumb) : thumb.url, mime, { signal: controller.signal })
        preview = prepared && { ...prepared, ...(mediaDimensions(file) || mediaDimensions(prepared)), animated: false }
      } else {
        if (localOnly && !await checkLocalPrivateMedia(file, { signal: controller.signal })) return null
        if (!localOnly) await ensurePrivateMedia(file, { signal: controller.signal })
        preview = await prepareMediaPreview(localOnly ? localAttachmentUrl(file) : file.url, file.mime, { signal: controller.signal })
      }
      return controller.signal.aborted ? null : rememberAttachmentPreview(file, preview)
    })().finally(() => { if (pending.get(pendingKey) === entry) pending.delete(pendingKey) })
    pending.set(pendingKey, entry)
  }
  entry.consumers++
  try {
    const preview = await new Promise((resolve, reject) => {
      const canceled = () => reject(signal.reason)
      signal?.addEventListener('abort', canceled, { once: true })
      entry.work.then(resolve, reject).finally(() => signal?.removeEventListener('abort', canceled))
      if (signal?.aborted) canceled()
    })
    // A local miss is not a miss for a user-visible normal request. It may use
    // the existing download policy after the local-only attempt has settled.
    if (!preview && !localOnly && pendingKey !== key) return acquireAttachmentPreview(file, { signal })
    return acquire(preview, signal)
  } finally {
    if (--entry.consumers === 0) {
      if (pending.get(pendingKey) === entry) pending.delete(pendingKey)
      entry.controller.abort()
    }
  }
}
