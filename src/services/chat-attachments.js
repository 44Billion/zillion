import { prepareIrfsFile } from 'libp2r2p/irfs'
import { encodedFileName } from '#helpers/attachment-presentation.js'
import { nfileEncode } from 'libp2r2p/nip19'
import { decodeFileMetadata } from 'libp2r2p/nip94'
import { rgbaToThumbHash } from 'thumbhash'
import { bytesToBase64 } from 'libp2r2p/base64'
import { abortable, preparationSignal } from '#helpers/media-dimensions.js'

export function messageAttachment (event) {
  if (event?.kind !== 1063) return null
  try { return decodeFileMetadata(event) } catch { return null }
}

export function attachmentCatalog (events) {
  const roots = new Set()
  return [...events].sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id)).flatMap(event => {
    const file = messageAttachment(event)
    if (event.status && event.status !== 'saved') return []
    if (!file?.root || new URL(file.url).origin !== 'https://nostr.alt' || !/^(image|video)\//.test(file.mime) || !file.width || !file.height || roots.has(file.root)) return []
    roots.add(file.root)
    return [file]
  })
}

async function visualMetadata (source, mime, signal) {
  if (!/^(image|video)\//.test(mime)) return {}
  const video = mime.startsWith('video/')
  const element = video ? document.createElement('video') : new Image()
  try {
    if (video) {
      element.muted = true
      element.preload = 'auto'
      await abortable(new Promise((resolve, reject) => {
        element.onloadeddata = resolve
        element.onerror = () => reject(new Error('INVALID_VIDEO'))
        element.src = source
      }), signal)
    } else {
      element.src = source
      await abortable(element.decode(), signal)
    }
    const width = video ? element.videoWidth : element.naturalWidth
    const height = video ? element.videoHeight : element.naturalHeight
    if (!(width > 0 && height > 0)) return {}
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 100 / Math.max(width, height))
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(element, 0, 0, canvas.width, canvas.height)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      return { width, height, thumbhash: bytesToBase64(rgbaToThumbHash(canvas.width, canvas.height, data)) }
    } catch { return { width, height } }
  } finally {
    element.onloadeddata = element.onerror = null
    element.removeAttribute('src')
    if (video) element.load()
  }
}

export async function prepareAttachment (file, { signal } = {}) {
  if (!file.size) throw new Error('EMPTY_IRFS_FILE')
  const controller = new AbortController()
  const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
  const source = URL.createObjectURL(file)
  let prepared
  const close = () => { controller.abort(); prepared?.close(); URL.revokeObjectURL(source) }
  try {
    // A failed preview does not discard a valid file. Hashing has no arbitrary
    // time limit; decoding a preview does, independently of preparation.
    const visual = visualMetadata(source, file.type, preparationSignal(combined)).catch(() => ({}))
    prepared = await prepareIrfsFile(file, { signal: combined })
    const dimensions = await visual
    combined.throwIfAborted()
    const mime = file.type || 'application/octet-stream'
    const filename = encodedFileName({ filename: file.name, root: prepared.root, mime })
    const entity = nfileEncode({ root: prepared.root, mime, filename })
    return { prepared, source, close, metadata: { root: prepared.root, size: file.size, mime, filename, url: `https://nostr.alt/${entity}?localOnly=1`, service: 'irfs', ...dimensions } }
  } catch (error) { close(); throw error }
}

// Consume the stream with bounded memory, confirming every byte is available
// locally before committing its retaining metadata event.
export async function verifyLocalFile (file, { signal } = {}) {
  const url = new URL(file.url)
  if (url.origin !== 'https://nostr.alt' || url.searchParams.get('localOnly') !== '1') throw new Error('INVALID_LOCAL_FILE')
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) throw new Error('FILE_UNAVAILABLE')
  const reader = response.body.getReader()
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > file.size) throw new Error('INVALID_FILE_SIZE')
    }
    if (size !== file.size) throw new Error('INVALID_FILE_SIZE')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
