import mime from 'mime'
import { nfileDecode, nfileEncode } from 'libp2r2p/nip19'

const encoder = new TextEncoder()

function referenceFrom (value) {
  try {
    const url = new URL(value)
    if (url.origin === 'https://nostr.alt') return nfileDecode(url.pathname.slice(1))
  } catch { /* External files need not have an nfile reference. */ }
}

export function fileName (file = {}, unnamed = 'unnamed-file') {
  const reference = referenceFrom(file.url)
  const provided = [file.filename, reference?.filename].find(value => typeof value === 'string' && value.trim())
  const fallback = [file.root, reference?.root, file.originalSha256, file.sha256].find(value => typeof value === 'string' && value.trim())
  const generic = !provided && !fallback
  // Names are filenames, never paths. Keep a stable, download-safe display name.
  const safe = [...(provided || fallback || unnamed)].map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '_' : character).join('')
  const name = safe.replace(/[\\/:*?"<>|]/g, '_').replace(/^[. ]+|[. ]+$/g, '') || unnamed
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot) : `.${mime.getExtension(file.mime || reference?.mime || '') || 'bin'}`
  const base = dot > 0 ? name.slice(0, dot) : name
  return { base, extension, full: base + extension, generic }
}

// Measure the complete label together so shaping and ellipsis never leave an
// unused flex-column gap before the extension. Preserve grapheme boundaries.
export function fitFileName (name, width, measure) {
  if (measure(name.full) <= width) return name.full
  const suffix = '…' + name.extension.slice(1)
  const characters = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name.base), item => item.segment)
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (measure(characters.slice(0, middle).join('') + suffix) <= width) low = middle
    else high = middle - 1
  }
  return characters.slice(0, low).join('') + suffix
}

export function encodedFileName (file, unnamed) {
  const { base, extension } = fileName(file, unnamed)
  // The TLV field is byte-limited, not character-limited. Never split UTF-8.
  if (encoder.encode(extension).length >= 255) throw new Error('FILE_EXTENSION_TOO_LONG')
  let result = ''
  const budget = 255 - encoder.encode(extension).length
  let bytes = 0
  for (const character of base) {
    bytes += encoder.encode(character).length
    if (bytes > budget) break
    result += character
  }
  return result + extension
}

export function fileDownloadSource (value, metadata = {}, unnamed) {
  const url = new URL(value)
  url.hash = ''
  if (url.origin !== 'https://nostr.alt') return url.href
  const reference = nfileDecode(url.pathname.slice(1))
  const filename = encodedFileName({ ...metadata, url: url.href, filename: reference.filename }, unnamed)
  if (filename !== reference.filename) url.pathname = `/${nfileEncode({ ...reference, filename })}`
  return url.href
}

export function fileSize (bytes, locale = 'en') {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB']
  let index = 0
  let value = bytes
  while (value >= 1000 && index < units.length - 1) { value /= 1000; index++ }
  if (Math.round(value * 10) / 10 >= 1000 && index < units.length - 1) { value /= 1000; index++ }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1, useGrouping: false }).format(value) + units[index]
}

export function fileCategory (type = '') {
  if (/^(image|video)\//.test(type)) return 'media'
  if (type.startsWith('audio/')) return 'audio'
  if (/zip|compressed|tar|gzip|rar|7z/.test(type)) return 'archive'
  if (/^text\/|pdf|document|sheet|presentation|json|xml/.test(type)) return 'document'
  return 'other'
}

export function attachmentSizeStyle (size) {
  const valid = Number.isFinite(size?.width) && size.width > 0 && Number.isFinite(size?.height) && size.height > 0
  const ratio = valid ? size.width / size.height : 1
  const width = valid ? Math.max(160, Math.min(320, 360 * ratio)) : 320
  // The frame may letterbox tall media: its minimum width belongs to the
  // filename as well. A container query unit keeps height responsive to width.
  return `width: ${width}px; --attachment-ratio: ${ratio};`
}
