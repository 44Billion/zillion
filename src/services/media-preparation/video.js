import { Input, ALL_FORMATS, CustomSource, CanvasSink, EncodedPacketSink } from 'mediabunny'
import { abortable } from '#helpers/media-dimensions.js'

async function mediabunnyPreview (source, { signal, target = 320 } = {}) {
  const input = new Input({
    formats: ALL_FORMATS, source: new CustomSource({
      getSize: () => source.size,
      read: (start, end) => {
        let offset = start
        return new ReadableStream({
          async pull (controller) {
            try {
              signal?.throwIfAborted()
              if (offset >= end) { controller.close(); return }
              const bytes = await source.read(offset, Math.min(end, offset + 65536))
              if (!bytes.length) throw new Error('TRUNCATED_VIDEO')
              offset += bytes.length
              controller.enqueue(bytes)
            } catch (error) { controller.error(error) }
          }
        }, { highWaterMark: 0 })
      },
      maxCacheSize: 1048576,
      handleUnhandledError: () => {}
    })
  })
  const cancel = () => input.dispose()
  signal?.addEventListener('abort', cancel, { once: true })
  let canvas, tiny
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw new Error('VIDEO_DECODER_UNAVAILABLE')
    const width = await track.getDisplayWidth(); const height = await track.getDisplayHeight()
    if (!width || !height) throw new Error('INVALID_VIDEO_DIMENSIONS')
    const scale = Math.min(1, target / Math.max(width, height))
    const sink = new CanvasSink(track, { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), fit: 'contain', alpha: true, poolSize: 1, decoderOptions: { optimizeForLatency: true } })
    const packet = await new EncodedPacketSink(track).getFirstKeyPacket({ verifyKeyPackets: true })
    if (!packet) throw new Error('VIDEO_FRAME_UNAVAILABLE')
    const work = sink.getCanvas(packet.timestamp).then(result => {
      if (signal?.aborted && result) { result.canvas.width = result.canvas.height = 0; signal.throwIfAborted() }
      return result
    })
    const result = signal ? await abortable(work, signal) : await work
    if (!result) throw new Error('VIDEO_FRAME_UNAVAILABLE')
    canvas = result.canvas
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PREVIEW_ENCODING_FAILED')), 'image/png'))
    signal?.throwIfAborted()
    const hashScale = Math.min(1, 100 / Math.max(canvas.width, canvas.height))
    tiny = document.createElement('canvas')
    tiny.width = Math.max(1, Math.round(canvas.width * hashScale)); tiny.height = Math.max(1, Math.round(canvas.height * hashScale))
    const context = tiny.getContext('2d', { willReadFrequently: true })
    context.drawImage(canvas, 0, 0, tiny.width, tiny.height)
    return { blob, width, height, pixels: context.getImageData(0, 0, tiny.width, tiny.height).data, hashWidth: tiny.width, hashHeight: tiny.height, backend: 'mediabunny' }
  } finally {
    signal?.removeEventListener('abort', cancel)
    input.dispose()
    if (canvas) canvas.width = canvas.height = 0
    if (tiny) tiny.width = tiny.height = 0
  }
}

// Preserve playback formats on browsers with native <video> support but no
// WebCodecs decoder. This compatibility backend retains native frame costs.
export async function videoPreview (source, { signal = new AbortController().signal, input, target = 320 } = {}) {
  try { return await mediabunnyPreview(source, { signal, target }) } catch (error) {
    signal?.throwIfAborted()
    if (error.message !== 'VIDEO_DECODER_UNAVAILABLE') throw error
  }
  const video = document.createElement('video')
  const ownedUrl = input instanceof Blob ? URL.createObjectURL(input) : null
  let canvas, tiny
  try {
    video.muted = true
    video.preload = 'auto'
    await abortable(new Promise((resolve, reject) => {
      video.onloadeddata = resolve
      video.onerror = () => reject(new Error('VIDEO_DECODER_UNAVAILABLE'))
      video.src = ownedUrl || input
    }), signal)
    const width = video.videoWidth; const height = video.videoHeight
    if (!width || !height) throw new Error('INVALID_VIDEO_DIMENSIONS')
    const scale = Math.min(1, target / Math.max(width, height))
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PREVIEW_ENCODING_FAILED')), 'image/png'))
    signal.throwIfAborted()
    const hashScale = Math.min(1, 100 / Math.max(canvas.width, canvas.height))
    tiny = document.createElement('canvas')
    tiny.width = Math.max(1, Math.round(canvas.width * hashScale)); tiny.height = Math.max(1, Math.round(canvas.height * hashScale))
    const context = tiny.getContext('2d', { willReadFrequently: true })
    context.drawImage(canvas, 0, 0, tiny.width, tiny.height)
    return { blob, width, height, pixels: context.getImageData(0, 0, tiny.width, tiny.height).data, hashWidth: tiny.width, hashHeight: tiny.height, backend: 'native-video' }
  } finally {
    video.onloadeddata = video.onerror = null
    video.removeAttribute('src'); video.load()
    if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    if (canvas) canvas.width = canvas.height = 0
    if (tiny) tiny.width = tiny.height = 0
  }
}
