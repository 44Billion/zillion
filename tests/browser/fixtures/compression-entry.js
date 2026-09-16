import { createUploadArtifact } from '../../../src/services/media-preparation/artifact.js'
import { createTemporaryOutput, sweepTemporaryOutputs } from '../../../src/services/media-preparation/temporary-output.js'
import { prepareAttachment } from '../../../src/services/chat-attachments.js'
import { decodeIrfsChunk } from 'libp2r2p/irfs'

window.sweepOutputs = sweepTemporaryOutputs
window.listOutputs = async () => {
  try { const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('zillion-compression-v1'); return Array.fromAsync(dir.keys()) } catch { return [] }
}
window.makeImage = async (width, height, alpha = false) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  const pixels = context.createImageData(width, height)
  let seed = 73
  for (let at = 0; at < pixels.data.length; at += 4) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0
    pixels.data[at] = seed >>> 24; pixels.data[at + 1] = seed >>> 16; pixels.data[at + 2] = seed >>> 8
    pixels.data[at + 3] = alpha ? 96 : 255
  }
  context.putImageData(pixels, 0, 0)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  canvas.width = canvas.height = 0
  window.generatedFile = new File([blob], alpha ? 'alpha.png' : 'noise.png', { type: 'image/png' })
}
window.compressCase = async ({ generated = false, cancel = false, disabled = false, storageFailure = false, writeFailure = false, fidelity = false } = {}) => {
  const file = generated ? window.generatedFile : document.querySelector('input').files[0]
  const controller = new AbortController(); const steps = []
  let timer, artifact
  const getDirectory = navigator.storage.getDirectory
  const nativeWrite = FileSystemWritableFileStream.prototype.write
  if (writeFailure) FileSystemWritableFileStream.prototype.write = async () => { throw new DOMException('Test write failure', 'QuotaExceededError') }
  if (storageFailure) navigator.storage.getDirectory = async () => { throw new DOMException('Test storage failure', 'QuotaExceededError') }
  const start = performance.now()
  try {
    const work = createUploadArtifact(file, { signal: controller.signal, compress: !disabled, onProgress: value => steps.push(value) })
    if (cancel) timer = setTimeout(() => controller.abort(), 30)
    artifact = await work
    const output = artifact.file
    let image, comparison, containsExif
    if (file.name.includes('rotated') && artifact.changed) containsExif = new TextDecoder().decode(await output.slice(0, 65536).arrayBuffer()).includes('Exif')
    if (fidelity && artifact.changed) comparison = await compareImages(file, output)
    if (artifact.changed && output.type.startsWith('image/') && typeof ImageDecoder !== 'undefined' && await ImageDecoder.isTypeSupported(output.type)) {
      const decoder = new ImageDecoder({ data: output.stream(), type: output.type, preferAnimation: true })
      try {
        await decoder.completed; await decoder.tracks.ready
        const track = decoder.tracks.selectedTrack
        const { image: frame } = await decoder.decode({ frameIndex: 0 })
        const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
        const context = canvas.getContext('2d'); context.drawImage(frame, 0, 0)
        image = { width: frame.displayWidth, height: frame.displayHeight, frames: track.frameCount, repetitions: Number.isFinite(track.repetitionCount) ? track.repetitionCount : 'infinite', pixel: [...context.getImageData(0, 0, 1, 1).data] }
        frame.close(); canvas.width = canvas.height = 0
      } finally { decoder.close() }
    }
    return { changed: artifact.changed, reason: artifact.reason, size: output.size, original: file.size, name: output.name, mime: output.type, image, comparison, containsExif, steps, elapsed: performance.now() - start }
  } catch (error) { return { error: error.name + ': ' + error.message, steps, elapsed: performance.now() - start } } finally { navigator.storage.getDirectory = getDirectory; FileSystemWritableFileStream.prototype.write = nativeWrite; clearTimeout(timer); await artifact?.close() }
}
window.checkFinalBytes = async () => {
  const prepared = await prepareAttachment(window.generatedFile)
  try {
    const chunks = await Array.fromAsync(prepared.prepared.chunks())
    const blob = new Blob(chunks.map(chunk => decodeIrfsChunk(chunk).contentBytes), { type: prepared.metadata.mime })
    const decoder = new ImageDecoder({ data: blob.stream(), type: blob.type })
    try { const { image } = await decoder.decode(); const result = { size: blob.size, metadata: prepared.metadata, width: image.displayWidth, height: image.displayHeight }; image.close(); return result } finally { decoder.close() }
  } finally { await prepared.close() }
}
window.makeOrphan = async () => { const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('zillion-compression-v1', { create: true }); await dir.getFileHandle('artifact-aaaaaaaa', { create: true }) }
window.holdOutput = async () => { window.heldOutput = await createTemporaryOutput(1000); await window.heldOutput.write(new Uint8Array([1, 2])); return window.heldOutput.name }
window.closeOutput = async () => { await window.heldOutput.close() }

window.repeatVideo = async cycles => {
  const M = await import('mediabunny')
  const file = document.querySelector('input').files[0]
  const input = new M.Input({ source: new M.BlobSource(file, { maxCacheSize: 1048576 }), formats: M.ALL_FORMATS })
  const target = await createTemporaryOutput(1024 * 1024 * 1024)
  window.generatedOwner = target
  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: false }), target: new M.StreamTarget(new WritableStream({ write: chunk => target.write(chunk.data, chunk.position) }), { chunked: true, chunkSize: 1048576 }) })
  try {
    let duration = await input.computeDuration()
    const packets = []
    for (const track of await input.getVideoTracks()) {
      const codec = await track.getCodec()
      const video = track.type === 'video'
      const source = video ? new M.EncodedVideoPacketSource(codec) : new M.EncodedAudioPacketSource(codec)
      if (video) output.addVideoTrack(source); else output.addAudioTrack(source)
      const config = await track.getDecoderConfig()
      for await (const packet of new M.EncodedPacketSink(track).packets()) { if (packet.timestamp >= 0) packets.push({ packet, source, config }) }
    }
    duration = packets.reduce((end, { packet }) => Math.max(end, packet.timestamp + packet.duration), duration)
    packets.sort((a, b) => a.packet.timestamp - b.packet.timestamp)
    await output.start()
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (const { packet, source, config } of packets) await source.add(packet.clone({ timestamp: packet.timestamp + cycle * duration }), { decoderConfig: config })
    }
    await output.finalize()
    const result = await target.finish()
    window.generatedFile = new File([result], 'repeated.mp4', { type: 'video/mp4' })
    return { size: result.size, duration: duration * cycles }
  } catch (error) { await output.cancel().catch(() => {}); await target.close(); throw error } finally { input.dispose() }
}
window.closeGenerated = async () => { window.generatedFile = null; await window.generatedOwner?.close(); window.generatedOwner = null }

async function compareImages (source, output) {
  const a = new ImageDecoder({ data: source.stream(), type: source.type, preferAnimation: true })
  const b = new ImageDecoder({ data: output.stream(), type: output.type, preferAnimation: true })
  const canvas = new OffscreenCanvas(100, 100); const context = canvas.getContext('2d', { willReadFrequently: true })
  let worst = 0; let alpha = 0
  try {
    await Promise.all([a.completed, b.completed, a.tracks.ready, b.tracks.ready])
    if (a.tracks.selectedTrack.frameCount !== b.tracks.selectedTrack.frameCount || a.tracks.selectedTrack.repetitionCount !== b.tracks.selectedTrack.repetitionCount) throw new Error('animation mismatch')
    for (let index = 0; index < a.tracks.selectedTrack.frameCount; index++) {
      const pixels = []
      for (const decoder of [a, b]) {
        const { image } = await decoder.decode({ frameIndex: index })
        try { context.clearRect(0, 0, 100, 100); context.drawImage(image, 0, 0, 100, 100); pixels.push(context.getImageData(0, 0, 100, 100).data) } finally { image.close() }
      }
      let error = 0; let alphaError = 0
      for (let at = 0; at < pixels[0].length; at += 4) {
        const aa = pixels[0][at + 3] / 255; const ab = pixels[1][at + 3] / 255
        alphaError += Math.abs(aa - ab) * 255
        for (let channel = 0; channel < 3; channel++) error += Math.abs(pixels[0][at + channel] * aa - pixels[1][at + channel] * ab)
      }
      worst = Math.max(worst, error / 30000); alpha = Math.max(alpha, alphaError / 10000)
    }
    return { colorError: worst, alphaError: alpha }
  } finally { a.close(); b.close(); canvas.width = canvas.height = 0 }
}

window.makeMultichannel = async () => {
  const original = document.querySelector('input').files[0]
  const header = await original.slice(0, 44).arrayBuffer(); const view = new DataView(header)
  view.setUint16(22, 4, true); view.setUint32(28, 384000, true); view.setUint16(32, 8, true)
  window.generatedFile = new File([header, original.slice(44)], 'four-channels.wav', { type: 'audio/wav' })
}
