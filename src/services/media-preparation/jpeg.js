// Read only marker headers before SOS. ImageDecoder validates the encoded image.
// JPEG scale-on-load is discrete; dimensions below its 1/8 scale can fail.
export async function jpegDimensions (source) {
  let offset = 2
  let width; let height; let progressive = false; let orientation = 1
  while (offset + 4 <= source.size) {
    const header = await source.read(offset, offset + 4)
    if (header[0] !== 255) throw new Error('INVALID_JPEG')
    if (header[1] === 255) { offset++; continue }
    const marker = header[1]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    const length = (header[2] << 8) | header[3]
    if (length < 2 || offset + length + 2 > source.size) throw new Error('INVALID_JPEG')
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const bytes = await source.read(offset + 4, offset + 9)
      height = (bytes[1] << 8) | bytes[2]; width = (bytes[3] << 8) | bytes[4]
      progressive = marker === 0xc2
    } else if (marker === 0xe1) {
      const bytes = await source.read(offset + 4, offset + length + 2)
      orientation = exifOrientation(bytes) || orientation
    }
    offset += length + 2
  }
  if (!width || !height) throw new Error('INVALID_JPEG')
  return { width, height, progressive, orientation }
}

export function exifOrientation (bytes) {
  try {
    if (String.fromCharCode(...bytes.subarray(0, 6)) !== 'Exif\0\0') return
    const view = new DataView(bytes.buffer, bytes.byteOffset + 6, bytes.length - 6)
    const little = view.getUint16(0) === 0x4949
    if (!little && view.getUint16(0) !== 0x4d4d) return
    if (view.getUint16(2, little) !== 42) return
    const offset = view.getUint32(4, little)
    const count = view.getUint16(offset, little)
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12
      if (view.getUint16(at, little) === 0x112 && view.getUint16(at + 2, little) === 3 && view.getUint32(at + 4, little) === 1) {
        const value = view.getUint16(at + 8, little)
        return value >= 1 && value <= 8 ? value : undefined
      }
    }
  } catch { /* Invalid optional EXIF must not prevent decoding the image. */ }
}

export function jpegDecodeSize ({ width, height }, target) {
  let divisor = 1
  while (divisor < 8 && Math.max(width, height) / (divisor * 2) >= target) divisor *= 2
  return { desiredWidth: Math.ceil(width / divisor), desiredHeight: Math.ceil(height / divisor) }
}
