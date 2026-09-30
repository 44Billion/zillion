import { privateMediaPeer } from './private-media.js'
import { prepareIrfsFile } from 'libp2r2p/irfs'
import { encodedFileName } from '#helpers/attachment-presentation.js'
import { nfileEncode } from 'libp2r2p/nip19'
import { decodeFileMetadata } from 'libp2r2p/nip94'
import { prepareMediaPreview } from './media-preparation/index.js'
import { createUploadArtifact } from './media-preparation/artifact.js'
import { rememberAttachmentPreview } from './attachment-previews.js'

export function messageAttachment (event) {
  if (event?.kind !== 1063) return null
  try { const file = decodeFileMetadata(event); return { ...file, ...(file.service === 'irfs' && new URL(file.url).origin === 'https://nostr.alt' && privateMediaPeer(event) ? { peer: privateMediaPeer(event), sharedAt: event.created_at } : {}) } } catch { return null }
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

export async function prepareAttachment (file, { signal, onProgress, compress = true } = {}) {
  const controller = new AbortController()
  const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
  let prepared, thumbnailPrepared, artifact, source
  const close = () => { controller.abort(); prepared?.close(); thumbnailPrepared?.close(); if (source) URL.revokeObjectURL(source); return artifact?.close() || Promise.resolve() }
  try {
    artifact = await createUploadArtifact(file, { signal: combined, onProgress, compress })
    const upload = artifact.file
    const mime = upload.type || 'application/octet-stream'
    // Preview and IRFS consume the SAME finalized artifact, including fallback.
    let preview
    try { preview = await prepareMediaPreview(upload, mime, { signal: combined, onProgress }) } catch { combined.throwIfAborted() }
    prepared = await prepareIrfsFile(upload, { signal: combined, onProgress: value => onProgress?.({ phase: 'hash', ...value }) })
    combined.throwIfAborted()
    const filename = encodedFileName({ filename: upload.name, root: prepared.root, mime })
    const entity = nfileEncode({ root: prepared.root, mime, filename })
    const metadata = { root: prepared.root, size: upload.size, mime, filename, url: `https://nostr.alt/${entity}?localOnly=1`, service: 'irfs', ...(preview ? { width: preview.width, height: preview.height, thumbhash: preview.thumbhash } : {}) }
    if (preview) {
      let small = preview
      for (const target of [160, 80]) {
        if (small.blob.size <= 51000) break
        small = await prepareMediaPreview(upload, mime, { signal: combined, target })
      }
      if (small.blob.size <= 51000) {
        thumbnailPrepared = await prepareIrfsFile(small.blob, { signal: combined })
        const thumbnailMime = small.blob.type || 'image/png'
        metadata.thumbnail = { root: thumbnailPrepared.root, size: small.blob.size, url: `https://nostr.alt/${nfileEncode({ root: thumbnailPrepared.root, mime: thumbnailMime })}?localOnly=1` }
      }
    }
    rememberAttachmentPreview(metadata, preview)
    source = preview ? URL.createObjectURL(preview.blob) : null
    return { prepared, thumbnailPrepared, source, close, metadata, compression: { changed: artifact.changed, reason: artifact.reason } }
  } catch (error) { await close(); throw error }
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
