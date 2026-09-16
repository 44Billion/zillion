import { nativeImageDimensions } from './native-image-dimensions.js'
import { compressionDimensions } from './dimensions.js'
import { mediaSource, sourceStream } from './source.js'
import { pngPreview } from './png.js'
import { jpegDimensions, jpegDecodeSize, exifOrientation } from './jpeg.js'

const acks = new Map()
let next = 0; let position = 0; let lastProgress = -1
const progress = value => {
  const percent = Math.floor(value * 100)
  if (percent > lastProgress) { lastProgress = percent; self.postMessage({ progress: percent / 100 }) }
}
const write = async (bytes, at = position) => {
  const id = ++next
  const ready = new Promise(resolve => acks.set(id, resolve))
  self.postMessage({ write: id, bytes, position: at }, [bytes.buffer])
  await ready
}
const append = async bytes => { const at = position; const length = bytes.byteLength; await write(bytes, at); position = at + length }
const writeBlob = async blob => {
  for (let offset = 0; offset < blob.size; offset += 65536) await append(new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer()))
}
const ascii = text => new TextEncoder().encode(text)
const u24 = (bytes, at, value) => { bytes[at] = value; bytes[at + 1] = value >>> 8; bytes[at + 2] = value >>> 16 }
const chunkHeader = (name, length) => { const bytes = new Uint8Array(8); bytes.set(ascii(name)); new DataView(bytes.buffer).setUint32(4, length, true); return bytes }

self.onmessage = async ({ data }) => {
  if (data.ack) { acks.get(data.ack)?.(); acks.delete(data.ack); return }
  try { self.postMessage({ result: data.expected ? await validate(data.file, data.expected) : await compress(data.file) }) } catch (error) { self.postMessage({ error: error.message || String(error) }) }
}

async function decoderFor (file, type = file.type, options = {}) {
  if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(type)) throw new Error('UNSUPPORTED_IMAGE_COMPRESSION')
  const decoder = new ImageDecoder({ data: sourceStream(await mediaSource(file)), type, preferAnimation: true, ...options })
  try { await decoder.tracks.ready; return decoder } catch (error) { decoder.close(); throw error }
}

async function pngInfo (source) {
  const bytes = await source.read(0, 33)
  if (bytes.length !== 33) throw new Error('INVALID_PNG')
  const view = new DataView(bytes.buffer)
  let offset = 8; let animated = false; let orientation = 1
  while (offset + 8 <= source.size) {
    const header = await source.read(offset, offset + 8)
    const length = new DataView(header.buffer).getUint32(0)
    const type = String.fromCharCode(...header.subarray(4))
    if (type === 'acTL') animated = true
    if (type === 'eXIf' && length < 65530) {
      const exif = new Uint8Array(6 + length); exif.set([69, 120, 105, 102, 0, 0]); exif.set(await source.read(offset + 8, offset + 8 + length), 6)
      orientation = exifOrientation(exif) || 1
    }
    if (type === 'IEND') break
    offset += length + 12
  }
  return { width: view.getUint32(16), height: view.getUint32(20), animated, orientation }
}

async function compress (file) {
  const source = await mediaSource(file)
  const header = await source.read(0, Math.min(16, file.size))
  const png = header[0] === 137 && header[1] === 80
  const jpeg = header[0] === 255 && header[1] === 216
  let input = file; let options = {}; let dimensions; let metadata
  if (!png && !jpeg) await nativeImageDimensions(source)
  if (png) {
    metadata = await pngInfo(source)
    if (metadata.animated && metadata.width * metadata.height > 16 * 1024 * 1024) throw new Error('COMPRESSION_NATIVE_MEMORY_LIMIT')
    if (!metadata.animated) {
      dimensions = metadata.orientation >= 5 ? compressionDimensions(metadata.height, metadata.width) : compressionDimensions(metadata.width, metadata.height)
      // Decode/reduce directly at upload resolution in linear sRGB. The
      // thumbnail's encoded-color averaging is deliberately not reused.
      try {
        input = (await pngPreview(source, undefined, Math.max(dimensions.width, dimensions.height), { linear: true, onProgress: value => progress(value * 0.8) })).blob
      } catch (error) {
        if (error.message !== 'UNSUPPORTED_COMPRESSION_COLOR_PROFILE') throw error
        if (metadata.width * metadata.height > 16 * 1024 * 1024) throw error
        input = file
      }
    }
  } else if (jpeg) {
    metadata = await jpegDimensions(source)
    if (metadata.progressive && metadata.width * metadata.height > 16 * 1024 * 1024) throw new Error('COMPRESSION_NATIVE_MEMORY_LIMIT')
    const swapped = metadata.orientation >= 5
    dimensions = compressionDimensions(swapped ? metadata.height : metadata.width, swapped ? metadata.width : metadata.height)
    options = jpegDecodeSize(metadata, Math.max(dimensions.width, dimensions.height))
    if (options.desiredWidth * options.desiredHeight > 16 * 1024 * 1024) throw new Error('COMPRESSION_NATIVE_MEMORY_LIMIT')
  }
  // Native image streams retain compressed input. Bound that compatibility
  // working set; larger files remain sendable in their original representation.
  if (input === file && file.size > 32 * 1024 * 1024) throw new Error('COMPRESSION_NATIVE_MEMORY_LIMIT')
  let decoder, frame, canvas
  try {
    decoder = await decoderFor(input, png ? 'image/png' : jpeg ? 'image/jpeg' : file.type, options)
    const track = decoder.tracks.selectedTrack
    if (track.animated) await decoder.completed
    const count = track.animated ? track.frameCount : 1
    if (!count || count > 10000) throw new Error('UNSUPPORTED_ANIMATION_LENGTH')
    const loops = track.animated ? track.repetitionCount === Infinity ? 0 : track.repetitionCount + 1 : 1
    let totalDuration = 0; let alpha = false
    for (let index = 0; index < count; index++) {
      ;({ image: frame } = await decoder.decode({ frameIndex: index, completeFramesOnly: true }))
      if (frame.displayWidth * frame.displayHeight > 16 * 1024 * 1024) throw new Error('COMPRESSION_NATIVE_MEMORY_LIMIT')
      dimensions ||= compressionDimensions(frame.displayWidth, frame.displayHeight)
      canvas ||= new OffscreenCanvas(dimensions.width, dimensions.height)
      const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(frame, 0, 0, canvas.width, canvas.height)
      const duration = frame.duration
      frame.close(); frame = null
      // Inspect strips instead of allocating another full RGBA output surface.
      let frameAlpha = false
      for (let y = 0; y < canvas.height && !frameAlpha; y += 16) {
        const pixels = context.getImageData(0, y, canvas.width, Math.min(16, canvas.height - y)).data
        for (let at = 3; at < pixels.length; at += 4) if (pixels[at] !== 255) { frameAlpha = true; break }
      }
      alpha ||= frameAlpha
      if (count === 1 && !track.animated) {
        progress(0.85)
        const mime = alpha ? 'image/webp' : 'image/jpeg'
        const blob = await canvas.convertToBlob({ type: mime, quality: 0.7 })
        if (blob.type !== mime) throw new Error('UNSUPPORTED_IMAGE_ENCODER')
        await writeBlob(blob)
        progress(1)
        return { mime, extension: alpha ? 'webp' : 'jpg', ...dimensions, frames: 1, animated: false, alpha }
      }
      if (index === 0) {
        await append(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]))
        await append(chunkHeader('VP8X', 10))
        const vp8x = new Uint8Array(10); vp8x[0] = 2
        u24(vp8x, 4, dimensions.width - 1); u24(vp8x, 7, dimensions.height - 1)
        await append(vp8x)
        await append(chunkHeader('ANIM', 6))
        const anim = new Uint8Array(6); new DataView(anim.buffer).setUint16(4, loops, true)
        await append(anim)
      }
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.7 })
      if (blob.type !== 'image/webp') throw new Error('UNSUPPORTED_IMAGE_ENCODER')
      const parts = []; let payload = 16
      for (let offset = 12; offset + 8 <= blob.size;) {
        const head = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer())
        const name = String.fromCharCode(...head.subarray(0, 4)); const length = new DataView(head.buffer).getUint32(4, true)
        const end = offset + 8 + length + (length % 2)
        if (end > blob.size) throw new Error('INVALID_ENCODED_WEBP')
        if (['ALPH', 'VP8 ', 'VP8L'].includes(name)) { parts.push(blob.slice(offset, end)); payload += end - offset }
        offset = end
      }
      if (!parts.length || !Number.isFinite(duration) || duration <= 0) throw new Error('INVALID_ANIMATION_FRAME')
      const milliseconds = Math.round((totalDuration + duration) / 1000) - Math.round(totalDuration / 1000)
      if (milliseconds > 0xffffff) throw new Error('UNSUPPORTED_ANIMATION_DURATION')
      totalDuration += duration
      await append(chunkHeader('ANMF', payload))
      const anmf = new Uint8Array(16)
      u24(anmf, 6, dimensions.width - 1); u24(anmf, 9, dimensions.height - 1); u24(anmf, 12, milliseconds)
      anmf[15] = 2 // Full composited frames replace rather than blend.
      await append(anmf)
      for (const part of parts) await writeBlob(part)
      progress((index + 1) / count)
    }
    if (position - 8 > 0xffffffff) throw new Error('UNSUPPORTED_WEBP_SIZE')
    const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, position - 8, true)
    await write(size, 4)
    await write(Uint8Array.of(alpha ? 0x12 : 2), 20)
    return { mime: 'image/webp', extension: 'webp', ...dimensions, frames: count, animated: true, loops, duration: Math.round(totalDuration / 1000), alpha }
  } finally { frame?.close(); decoder?.close(); if (canvas) canvas.width = canvas.height = 0 }
}

async function validate (file, expected) {
  const decoder = await decoderFor(file, expected.mime)
  let frame
  try {
    await decoder.completed
    const track = decoder.tracks.selectedTrack
    if (track.frameCount !== expected.frames || track.animated !== expected.animated) throw new Error('INVALID_COMPRESSED_ANIMATION')
    if (expected.animated && (track.repetitionCount === Infinity ? 0 : track.repetitionCount + 1) !== expected.loops) throw new Error('INVALID_COMPRESSED_LOOP')
    let duration = 0
    for (let index = 0; index < expected.frames; index++) {
      ;({ image: frame } = await decoder.decode({ frameIndex: index, completeFramesOnly: true }))
      if (frame.displayWidth !== expected.width || frame.displayHeight !== expected.height) throw new Error('INVALID_COMPRESSED_DIMENSIONS')
      duration += frame.duration || 0
      frame.close(); frame = null
    }
    if (expected.animated && Math.abs(duration / 1000 - expected.duration) > 1) throw new Error('INVALID_COMPRESSED_DURATION')
    return true
  } finally { frame?.close(); decoder.close() }
}
