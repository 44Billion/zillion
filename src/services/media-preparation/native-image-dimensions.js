// Probe allocation sizes before opening a native image decoder. AVIF properties
// are read as bounded box headers, not by scanning/materializing the input.
export async function nativeImageDimensions (source) {
  const bytes = await source.read(0, Math.min(64, source.size))
  const word = at => String.fromCharCode(...bytes.subarray(at, at + 4))
  let width, height
  if (String.fromCharCode(...bytes.subarray(0, 3)) === 'GIF') {
    width = bytes[6] | bytes[7] << 8; height = bytes[8] | bytes[9] << 8
  } else if (word(8) === 'WEBP') {
    const type = word(12)
    if (type === 'VP8X') { width = 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16); height = 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16) } else if (type === 'VP8L' && bytes[20] === 47) { const bits = new DataView(bytes.buffer).getUint32(21, true); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1 } else if (type === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = (bytes[26] | bytes[27] << 8) & 16383; height = (bytes[28] | bytes[29] << 8) & 16383 }
  } else if (word(4) === 'ftyp') {
    const stack = [[0, source.size, 0]]
    let boxes = 0
    while (stack.length) {
      const [start, end, depth] = stack.pop()
      if (depth > 8) throw new Error('INVALID_IMAGE_BOXES')
      for (let offset = start; offset + 8 <= end;) {
        if (++boxes > 10000) throw new Error('INVALID_IMAGE_BOXES')
        const header = await source.read(offset, Math.min(offset + 16, end))
        const view = new DataView(header.buffer, header.byteOffset, header.length)
        let length = view.getUint32(0); let head = 8
        if (length === 1) { length = Number(view.getBigUint64(8)); head = 16 }
        if (length === 0) length = end - offset
        if (!Number.isSafeInteger(length) || length < head || offset + length > end) throw new Error('INVALID_IMAGE_BOXES')
        const type = String.fromCharCode(...header.subarray(4, 8))
        if (['meta', 'iprp', 'ipco'].includes(type)) stack.push([offset + head + (type === 'meta' ? 4 : 0), offset + length, depth + 1])
        if (type === 'ispe') {
          if (length < head + 12) throw new Error('INVALID_IMAGE_BOXES')
          const size = await source.read(offset + head + 4, offset + head + 12)
          const values = new DataView(size.buffer, size.byteOffset, size.length)
          const w = values.getUint32(0); const h = values.getUint32(4)
          if (!width || w * h > width * height) { width = w; height = h }
        }
        offset += length
      }
    }
  }
  if (!width || !height || width * height > 16 * 1024 * 1024) throw new Error('COMPRESSION_NATIVE_MEMORY_LIMIT')
  return { width, height }
}
