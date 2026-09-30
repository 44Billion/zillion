import { rgbaToDataURL, thumbHashToRGBA } from 'thumbhash'
import { base64ToBytes } from 'libp2r2p/base64'

// Missing original dimensions can still reserve the hash's approximate aspect
// ratio. Declared dimensions and prepared previews take precedence over it.
export function attachmentPlaceholder (file) {
  try {
    const hash = base64ToBytes(file?.thumbhash)
    if (hash.length < 17 || hash.length > 25) return null
    const { w: width, h: height, rgba } = thumbHashToRGBA(hash)
    return width > 0 && height > 0 ? { source: rgbaToDataURL(width, height, rgba), width, height } : null
  } catch { return null }
}
