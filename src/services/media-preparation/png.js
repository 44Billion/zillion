// PNG row reduction: two scanlines and target-sized accumulators, including
// Adam7, palette and transparency. Previews average encoded color; compression
// requests a separate linear-sRGB reduction at the final upload resolution.
// Unrecognized profiles use native color management or keep the original.
import { Inflate, deflate } from 'pako'
function readIHDR (head) {
  if (head.length !== 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v2, i) => head[i] === v2) || String.fromCharCode(...head.subarray(12, 16)) !== 'IHDR') throw Error('INVALID_PNG')
  const v = new DataView(head.buffer, head.byteOffset, head.length)
  const width = v.getUint32(16)
  const height = v.getUint32(20)
  const depth = head[24]
  const colorType = head[25]
  const interlace = head[28]
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
  if (v.getUint32(8) !== 13 || !width || !height || width > 2147483647 || height > 2147483647 || !Number.isSafeInteger(width * height) || !depths[colorType]?.includes(depth) || head[26] || head[27] || interlace > 1) throw Error('INVALID_PNG')
  return { width, height, depth, colorType, interlace }
}
const table = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1
  table[n] = c >>> 0
}
const crc = (b, c = 4294967295) => {
  for (const x of b) c = table[(c ^ x) & 255] ^ c >>> 8
  return c >>> 0
}
function chunk (type, data) {
  const b = new Uint8Array(data.length + 12)
  const v = new DataView(b.buffer)
  v.setUint32(0, data.length)
  b.set(new TextEncoder().encode(type), 4)
  b.set(data, 8)
  v.setUint32(data.length + 8, (crc(b.subarray(4, data.length + 8)) ^ 4294967295) >>> 0)
  return b
}
async function pngPreview (file, signal, maxDimension = 320, { linear = false, onProgress } = {}) {
  const head = await file.read(0, 33)
  const { width, height, depth, colorType, interlace } = readIHDR(head)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels || !width || !height) throw Error('Unsupported PNG')
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  const tw = Math.max(1, Math.round(width * scale))
  const th = Math.max(1, Math.round(height * scale))
  const toLinear = value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const toEncoded = value => 255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055)
  const sums = new Float64Array(tw * th * 5)
  const pixels = new Uint8ClampedArray(tw * th * 4)
  const colorChunks = []
  const seenMetadata = new Set()
  let palette, transparency
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
  let pass = -1
  let pw
  let ph
  let rowBytes
  let previous
  let current
  let position = -1
  let filter
  let y = 0
  let done = false
  const bpp = Math.max(1, Math.ceil(channels * depth / 8))
  const maximum = 2 ** depth - 1
  function nextPass () {
    while (++pass < passes.length) {
      const [x0, y0, dx, dy] = passes[pass]
      pw = Math.ceil((width - x0) / dx)
      ph = Math.ceil((height - y0) / dy)
      if (pw > 0 && ph > 0) {
        rowBytes = Math.ceil(pw * channels * depth / 8)
        if (rowBytes > 16 * 1024 * 1024) throw Error('PNG_SCANLINE_MEMORY_LIMIT')
        previous = new Uint8Array(rowBytes)
        current = new Uint8Array(rowBytes)
        y = 0
        position = -1
        return
      }
    }
    done = true
  }
  nextPass()
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  const sample = (i) => depth === 16 ? current[i * 2] << 8 | current[i * 2 + 1] : depth === 8 ? current[i] : current[Math.floor(i * depth / 8)] >>> 8 - depth - i * depth % 8 & maximum
  function reduceRow () {
    const [x0, y0, dx, dy] = passes[pass]
    const ty = Math.min(th - 1, Math.floor((y0 + y * dy) * th / height))
    for (let x = 0; x < pw; x++) {
      const at = x * channels
      const v0 = sample(at)
      let a = 255
      let r
      let g
      let b
      if (colorType === 3) {
        if (!palette || v0 * 3 + 2 >= palette.length) throw Error('Invalid palette')
        r = palette[v0 * 3]
        g = palette[v0 * 3 + 1]
        b = palette[v0 * 3 + 2]
        a = transparency?.[v0] ?? 255
      } else if (colorType === 0 || colorType === 4) {
        r = g = b = v0 * 255 / maximum
        if (colorType === 4) a = sample(at + 1) * 255 / maximum
        else if (transparency && v0 === (transparency[0] << 8 | transparency[1])) a = 0
      } else {
        const v1 = sample(at + 1)
        const v2 = sample(at + 2)
        r = v0 * 255 / maximum
        g = v1 * 255 / maximum
        b = v2 * 255 / maximum
        if (colorType === 6) a = sample(at + 3) * 255 / maximum
        else if (transparency && v0 === (transparency[0] << 8 | transparency[1]) && v1 === (transparency[2] << 8 | transparency[3]) && v2 === (transparency[4] << 8 | transparency[5])) a = 0
      }
      const tx = Math.min(tw - 1, Math.floor((x0 + x * dx) * tw / width))
      const p = (ty * tw + tx) * 5
      sums[p] += (linear ? toLinear(r) : r) * a
      sums[p + 1] += (linear ? toLinear(g) : g) * a
      sums[p + 2] += (linear ? toLinear(b) : b) * a
      sums[p + 3] += a
      sums[p + 4]++
    }
  }
  const inflate = new Inflate({ chunkSize: 16384 })
  inflate.onData = (value) => {
    for (const v of value) {
      if (done) throw Error('Extra pixels')
      if (position === -1) {
        filter = v
        if (filter > 4) throw Error('Invalid filter')
        position = 0
        continue
      }
      const left = position >= bpp ? current[position - bpp] : 0
      const up = previous[position]
      const ul = position >= bpp ? previous[position - bpp] : 0
      current[position] = v + (filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? left + up >> 1 : paeth(left, up, ul)) & 255
      if (++position === rowBytes) {
        reduceRow()
        const swap = previous
        previous = current
        current = swap
        position = -1
        if (++y === ph) nextPass()
      }
    }
  }
  let offset = 8
  let chunks = 0
  let ended = false
  let seenHeader = false
  let seenData = false
  let closedData = false
  while (offset < file.size) {
    signal?.throwIfAborted()
    const header = await file.read(offset, offset + 8)
    if (header.length !== 8) throw Error('Truncated chunk')
    const length = new DataView(header.buffer).getUint32(0)
    const type = String.fromCharCode(...header.subarray(4))
    offset += 8
    if (!/^[a-zA-Z]{4}$/.test(type) || (!seenHeader && type !== 'IHDR') || (type === 'IHDR' && (seenHeader || length !== 13))) throw Error('INVALID_PNG_CHUNK')
    if (type === 'IHDR') seenHeader = true
    if (!['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type) && type[0] === type[0].toUpperCase()) throw Error('UNKNOWN_PNG_CRITICAL_CHUNK')
    if (type === 'IDAT') {
      if (closedData || (colorType === 3 && !palette)) throw Error('INVALID_PNG_IDAT')
      seenData = true
    } else if (seenData) closedData = true
    if (linear && ['iCCP', 'cHRM'].includes(type)) throw Error('UNSUPPORTED_COMPRESSION_COLOR_PROFILE')
    if (type === 'PLTE' && (seenData || palette || length % 3 || !length || length > 768)) throw Error('INVALID_PNG_PALETTE')
    if (type === 'tRNS' && (seenData || transparency || ![0, 2, 3].includes(colorType) || (colorType === 0 && length !== 2) || (colorType === 2 && length !== 6) || (colorType === 3 && (!palette || length > palette.length / 3)))) throw Error('INVALID_PNG_TRANSPARENCY')
    if (type === 'IEND' && length !== 0) throw Error('INVALID_PNG_END')
    if (offset + length + 4 > file.size) throw Error('Truncated PNG')
    let checksum = crc(header.subarray(4))
    const keep = ['PLTE', 'tRNS', 'iCCP', 'gAMA', 'cHRM', 'sRGB', 'eXIf'].includes(type)
    if (keep && seenMetadata.has(type)) throw Error('DUPLICATE_PNG_METADATA')
    if (keep) seenMetadata.add(type)
    const parts = keep ? [] : null
    if (keep && length > 1048576) throw Error('PNG_METADATA_MEMORY_LIMIT')
    for (let n = 0; n < length;) {
      signal?.throwIfAborted()
      const size = Math.min(8192, length - n)
      const bytes = await file.read(offset + n, offset + n + size)
      checksum = crc(bytes, checksum)
      if (type === 'IDAT') {
        inflate.push(bytes)
        if (inflate.err) throw Error(inflate.msg)
      }
      if (keep) parts.push(bytes)
      n += size
      onProgress?.((offset + n) / file.size)
      if (++chunks % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const expected = new DataView((await file.read(offset + length, offset + length + 4)).buffer).getUint32(0)
    if ((checksum ^ 4294967295) >>> 0 !== expected) throw Error('Invalid CRC: ' + type)
    if (keep) {
      const data = new Uint8Array(length)
      let n = 0
      for (const part of parts) {
        data.set(part, n)
        n += part.length
      }
      if (type === 'PLTE') palette = data
      else if (type === 'tRNS') transparency = data
      else {
        if (type === 'iCCP') {
          const separator = data.indexOf(0)
          if (separator < 1 || separator > 79 || data[separator + 1] !== 0) throw Error('INVALID_PNG_PROFILE')
          const profile = new Inflate({ chunkSize: 16384 })
          let profileBytes = 0
          profile.onData = bytes => { profileBytes += bytes.length; if (profileBytes > 4 * 1024 * 1024) throw Error('PNG_PROFILE_MEMORY_LIMIT') }
          profile.push(data.subarray(separator + 2), true)
          if (profile.err || !profile.ended) throw Error('INVALID_PNG_PROFILE')
        }
        if (linear && type === 'gAMA' && (data.length !== 4 || new DataView(data.buffer).getUint32(0) !== 45455)) throw Error('UNSUPPORTED_COMPRESSION_COLOR_PROFILE')
        if (!linear || type === 'eXIf') colorChunks.push(chunk(type, data))
      }
    }
    offset += length + 4
    if (type === 'IEND') {
      ended = true
      break
    }
  }
  if (!ended || !done || !seenData) throw Error('Truncated pixels')
  inflate.push(new Uint8Array(), true)
  if (inflate.err || !inflate.ended) throw Error(inflate.msg || 'Truncated PNG stream')
  for (let i = 0; i < tw * th; i++) {
    const p = i * 5
    const q = i * 4
    const a = sums[p + 3]
    if (a) {
      pixels[q] = linear ? toEncoded(sums[p] / a) : sums[p] / a
      pixels[q + 1] = linear ? toEncoded(sums[p + 1] / a) : sums[p + 1] / a
      pixels[q + 2] = linear ? toEncoded(sums[p + 2] / a) : sums[p + 2] / a
    }
    pixels[q + 3] = a / sums[p + 4]
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, tw)
  view.setUint32(4, th)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const raw = new Uint8Array(th * (tw * 4 + 1))
  for (let y2 = 0; y2 < th; y2++) raw.set(pixels.subarray(y2 * tw * 4, (y2 + 1) * tw * 4), y2 * (tw * 4 + 1) + 1)
  const blob = new Blob([head.subarray(0, 8), chunk('IHDR', ihdr), ...(linear ? [chunk('sRGB', Uint8Array.of(0))] : []), ...colorChunks, chunk('IDAT', deflate(raw)), chunk('IEND', new Uint8Array())], { type: 'image/png' })
  return { blob, width, height, thumbnailWidth: tw, thumbnailHeight: th }
}
export {
  pngPreview
}
