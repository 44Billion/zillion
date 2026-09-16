import { Input, Output, ALL_FORMATS, BlobSource, StreamTarget, Mp4OutputFormat, Mp3OutputFormat, Conversion, QUALITY_MEDIUM, canEncodeAudio, VideoSampleSink, AudioSampleSink } from 'mediabunny'
import { compressionDimensions } from './dimensions.js'

let mp3, aac
async function audioEncoder (codec) {
  if (await canEncodeAudio(codec)) return
  if (codec === 'mp3') await (mp3 ||= import('@mediabunny/mp3-encoder').then(module => module.registerMp3Encoder()))
  else await (aac ||= import('@mediabunny/aac-encoder').then(module => module.registerAacEncoder()))
}
const open = file => new Input({ source: new BlobSource(file, { maxCacheSize: 1048576 }), formats: ALL_FORMATS })

export async function compressMedia (file, temporary, { signal, onProgress }) {
  const input = open(file)
  let conversion, output
  const abort = () => { if (conversion) conversion.cancel().catch(() => {}); input.dispose() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const tracks = await input.getTracks()
    const videos = await input.getVideoTracks(); const audios = await input.getAudioTracks()
    const audioOnly = file.type.startsWith('audio/')
    if (videos.length > 1 || (audioOnly && (videos.length || audios.length !== 1)) || (!audioOnly && videos.length !== 1)) throw new Error('UNSUPPORTED_COMPRESSION_TRACKS')
    if (audioOnly && await audios[0].getNumberOfChannels() > 2) throw new Error('UNSUPPORTED_COMPRESSION_CHANNELS')
    const channels = await Promise.all(audios.map(track => track.getNumberOfChannels()))
    const offset = Math.max(0, await input.getFirstTimestamp(tracks))
    const duration = await input.computeDuration() - offset
    const timing = await Promise.all([...videos, ...audios].map(async track => ({ start: Math.max(0, await track.getFirstTimestamp() - offset), end: await track.computeDuration() - offset })))
    if (!(duration > 0 && Number.isFinite(duration))) throw new Error('INVALID_MEDIA_DURATION')
    if (audios.length) await audioEncoder(audioOnly ? 'mp3' : 'aac')
    const dimensions = videos.length ? compressionDimensions(await videos[0].getDisplayWidth(), await videos[0].getDisplayHeight(), { even: true }) : null
    output = new Output({
      format: audioOnly ? new Mp3OutputFormat() : new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(new WritableStream({ write: chunk => temporary.write(chunk.data, chunk.position) }), { chunked: true, chunkSize: 1048576 })
    })
    conversion = await Conversion.init({
      input, output, tracks: 'all', tags: {}, showWarnings: false,
      video: dimensions ? { ...dimensions, fit: 'contain', codec: 'avc', quality: QUALITY_MEDIUM, keyFrameInterval: 2, forceTranscode: true, allowRotationMetadata: false } : undefined,
      audio: { codec: audioOnly ? 'mp3' : 'aac', bitrate: 128000, forceTranscode: true }
    })
    signal.throwIfAborted()
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error('UNSUPPORTED_COMPRESSION_TRACKS')
    let lastPercent = -1
    conversion.onProgress = progress => { signal.throwIfAborted(); const percent = Math.floor(progress * 100); if (percent !== lastPercent) { lastPercent = percent; onProgress?.({ phase: 'compress', progress: percent / 100 }) } }
    await conversion.execute()
    signal.throwIfAborted()
    return { mime: audioOnly ? 'audio/mpeg' : 'video/mp4', extension: audioOnly ? 'mp3' : 'mp4', duration, dimensions, tracks: tracks.length, audioTracks: audios.length, videoTracks: videos.length, channels, timing }
  } finally {
    signal.removeEventListener('abort', abort)
    if (conversion && output.state !== 'finalized') await conversion.cancel().catch(() => {})
    input.dispose()
  }
}

export async function validateOutput (file, expected, { signal }) {
  const input = open(file)
  const abort = () => input.dispose()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const tracks = await input.getTracks()
    const videos = await input.getVideoTracks(); const audios = await input.getAudioTracks()
    const duration = await input.computeDuration()
    if (tracks.length !== expected.tracks || videos.length !== expected.videoTracks || audios.length !== expected.audioTracks || Math.abs(duration - expected.duration) > 0.15) throw new Error(`INVALID_COMPRESSED_TRACKS: tracks ${tracks.length}/${expected.tracks}, duration ${duration}/${expected.duration}`)
    for (const [index, track] of [...videos, ...audios].entries()) {
      const start = Math.max(0, await track.getFirstTimestamp())
      const end = await track.computeDuration()
      if (Math.abs(start - expected.timing[index].start) > 0.15 || Math.abs(end - expected.timing[index].end) > 0.15) throw new Error('INVALID_COMPRESSED_SYNC')
    }
    for (const track of videos) {
      if (await track.getDisplayWidth() !== expected.dimensions.width || await track.getDisplayHeight() !== expected.dimensions.height) throw new Error('INVALID_COMPRESSED_DIMENSIONS')
      const sample = await new VideoSampleSink(track).getSample(await track.getFirstTimestamp())
      if (!sample) throw new Error('INVALID_COMPRESSED_VIDEO')
      sample.close()
    }
    for (const [index, track] of audios.entries()) {
      if (await track.getNumberOfChannels() !== expected.channels[index]) throw new Error('INVALID_COMPRESSED_CHANNELS')
      const sample = await new AudioSampleSink(track).getSample(await track.getFirstTimestamp())
      if (!sample) throw new Error('INVALID_COMPRESSED_AUDIO')
      sample.close()
    }
    signal.throwIfAborted()
  } finally { signal.removeEventListener('abort', abort); input.dispose() }
}
