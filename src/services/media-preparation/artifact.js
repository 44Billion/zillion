import { queueMedia } from './queue.js'
import { compressedName } from './dimensions.js'

// The finalized File owns the bytes used by BOTH preview and IRFS. Encoded
// output remains disk-backed until the composer/outbox explicitly closes it.
export async function createUploadArtifact (input, { signal, compress = true, onProgress } = {}) {
  signal?.throwIfAborted()
  if (!(input instanceof Blob) || !input.size) throw new Error('EMPTY_IRFS_FILE')
  const controller = new AbortController()
  const current = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
  let file = input; let temporary; let changed = false; let reason = compress ? 'not-media' : 'disabled'; let closing
  const close = () => {
    if (closing) return closing
    current.removeEventListener('abort', onAbort)
    controller.abort(); file = null
    closing = temporary?.close() || Promise.resolve()
    closing.catch(() => {})
    return closing
  }
  const onAbort = () => { close() }
  try {
    if (compress && /^(image|audio|video)\//.test(input.type)) {
      try {
        await queueMedia(async () => {
          const { createTemporaryOutput } = await import('./temporary-output.js')
          temporary = await createTemporaryOutput(input.size, { signal: current })
          onProgress?.({ phase: 'compress', progress: 0 })
          const module = input.type.startsWith('image/') ? await import('./compress-image.js') : await import('./compress-av.js')
          const result = await module.compressMedia(input, temporary, { signal: current, onProgress })
          current.throwIfAborted()
          const output = await temporary.finish()
          await module.validateOutput(output, result, { signal: current })
          current.throwIfAborted()
          if (!output.size || output.size >= input.size) throw new Error('COMPRESSION_NOT_SMALLER')
          file = new File([output], compressedName(input.name, result.extension), { type: result.mime, lastModified: input.lastModified })
          changed = true; reason = null
        }, current)
      } catch (error) {
        // Wait for the active job to release its writer before returning fallback.
        await temporary?.close().catch(() => {})
        temporary = null
        current.throwIfAborted()
        onProgress?.({ phase: 'fallback', reason: error.message })
        reason = error.message === 'COMPRESSION_NOT_SMALLER' ? 'not-smaller' : 'unavailable'
      }
    }
    current.throwIfAborted()
    current.addEventListener('abort', onAbort, { once: true })
    return {
      changed, reason,
      get file () {
        current.throwIfAborted()
        if (!file) throw new Error('MEDIA_ARTIFACT_CLOSED')
        return file
      },
      close
    }
  } catch (error) { await close(); throw error }
}
