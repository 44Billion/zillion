// Exact MIME values mirrored by personal-copy `o` tags. Keep selection and
// count independent of this device's codecs. Unsupported playback keeps a slot.
export const VIEWER_MIMES = Object.freeze([
  'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/apng', 'image/gif',
  'image/webp', 'image/avif', 'image/svg+xml', 'image/bmp', 'image/x-bmp',
  'image/x-ms-bmp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/tiff',
  'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence', 'image/jxl',
  'video/mp4', 'video/x-m4v', 'video/webm', 'video/ogg', 'video/quicktime',
  'video/3gpp', 'video/matroska', 'video/x-matroska'
])
const supported = new Set(VIEWER_MIMES)
export const isViewerMime = mime => supported.has(mime)
export const compareMedia = (a, b) => a.created_at - b.created_at || (a.orderId < b.orderId ? 1 : a.orderId > b.orderId ? -1 : 0) || (a.slot ?? 0) - (b.slot ?? 0)
export function safeMediaUrl (value) {
  try { return new URL(value).protocol === 'https:' ? value : null } catch { return null }
}
