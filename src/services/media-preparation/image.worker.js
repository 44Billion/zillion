import { pngPreview } from './png.js'
import { jpegDimensions, jpegDecodeSize } from './jpeg.js'
import { sourceStream } from './source.js'

let nextRead = 0
const reads = new Map()
const read = (start, end) => new Promise((resolve, reject) => {
  const id = ++nextRead
  reads.set(id, { resolve, reject })
  self.postMessage({ read: id, start, end })
})
self.onmessage = async ({ data }) => {
  if (data.read) {
    const pending = reads.get(data.read)
    reads.delete(data.read)
    if (data.error) pending?.reject(new Error(data.error))
    else pending?.resolve(new Uint8Array(data.bytes))
    return
  }
  try { self.postMessage({ result: await preview({ size: data.size, read }, data.mime, data.target) }) } catch (error) {
    self.postMessage({ error: error.message || String(error) })
  }
}

async function preview (source, mime, target) {
  const header = await source.read(0, Math.min(16, source.size))
  const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71
  const jpeg = header[0] === 255 && header[1] === 216
  let imageSource = source; let nativeOptions = {}; let metadata
  if (png) {
    metadata = await pngPreview(source, undefined, target)
    imageSource = { size: metadata.blob.size, read: async (start, end) => new Uint8Array(await metadata.blob.slice(start, end).arrayBuffer()) }
    mime = 'image/png'
  } else if (jpeg) {
    metadata = await jpegDimensions(source)
    nativeOptions = jpegDecodeSize(metadata, target)
    mime = 'image/jpeg'
  }
  let decoder, frame, canvas
  try {
    if (typeof ImageDecoder !== 'undefined' && await ImageDecoder.isTypeSupported(mime)) {
      decoder = new ImageDecoder({ data: sourceStream(imageSource), type: mime, preferAnimation: false, ...nativeOptions })
      ;({ image: frame } = await decoder.decode({ frameIndex: 0 }))
    } else {
      // Preserve browser-supported formats without ImageDecoder (e.g. SVG).
      // This compatibility backend retains a format-dependent native decode cost.
      const parts = []
      for (let offset = 0; offset < imageSource.size; offset += 65536) parts.push(await imageSource.read(offset, Math.min(offset + 65536, imageSource.size)))
      frame = await createImageBitmap(new Blob(parts, { type: mime }), { imageOrientation: 'from-image' })
    }
    const frameWidth = frame.displayWidth ?? frame.width
    const frameHeight = frame.displayHeight ?? frame.height
    let width = metadata?.width ?? frameWidth; let height = metadata?.height ?? frameHeight
    if (metadata && (jpeg ? metadata.orientation >= 5 : (frameWidth === metadata.thumbnailHeight && frameHeight === metadata.thumbnailWidth && frameWidth !== frameHeight))) [width, height] = [height, width]
    const scale = Math.min(1, target / Math.max(frameWidth, frameHeight))
    canvas = new OffscreenCanvas(Math.max(1, Math.round(frameWidth * scale)), Math.max(1, Math.round(frameHeight * scale)))
    canvas.getContext('2d').drawImage(frame, 0, 0, canvas.width, canvas.height)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const hashScale = Math.min(1, 100 / Math.max(canvas.width, canvas.height))
    const tiny = new OffscreenCanvas(Math.max(1, Math.round(canvas.width * hashScale)), Math.max(1, Math.round(canvas.height * hashScale)))
    try {
      const context = tiny.getContext('2d', { willReadFrequently: true })
      context.drawImage(canvas, 0, 0, tiny.width, tiny.height)
      return { blob, width, height, pixels: context.getImageData(0, 0, tiny.width, tiny.height).data, hashWidth: tiny.width, hashHeight: tiny.height, backend: png ? 'png-rows' : jpeg ? metadata.progressive ? 'jpeg-progressive-native' : 'jpeg-scaled' : 'native' }
    } finally { tiny.width = tiny.height = 0 }
  } finally { frame?.close(); decoder?.close(); if (canvas) canvas.width = canvas.height = 0 }
}
