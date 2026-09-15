import workerSource from './image.worker.js?worker'

// One disposable worker per serialized job. Termination releases native decode
// buffers after success/error and interrupts synchronous decoding on cancellation.
export function imagePreview (source, mime, { signal, target = 320 } = {}) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
    let worker; let finished = false
    const finish = (error, result) => {
      if (finished) return
      finished = true
      worker?.terminate()
      URL.revokeObjectURL(url)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(result)
    }
    const abort = () => finish(signal.reason)
    try {
      worker = new Worker(url, { name: 'zillion-image-preview' })
      signal?.addEventListener('abort', abort, { once: true })
      worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'IMAGE_WORKER_FAILED')) }
      worker.onmessageerror = () => finish(new Error('IMAGE_WORKER_MESSAGE_FAILED'))
      worker.onmessage = async ({ data }) => {
        if (finished) return
        if (data.read) {
          try {
            if (!Number.isSafeInteger(data.start) || !Number.isSafeInteger(data.end) || data.start < 0 || data.end < data.start || data.end - data.start > 65536) throw new Error('INVALID_PREVIEW_READ')
            const bytes = await source.read(data.start, data.end)
            if (!finished) worker.postMessage({ read: data.read, bytes: bytes.buffer }, [bytes.buffer])
          } catch (error) { if (!finished) worker.postMessage({ read: data.read, error: error.message || String(error) }) }
        } else if (data.error) finish(new Error(data.error))
        else finish(null, data.result)
      }
      worker.postMessage({ size: source.size, mime, target })
    } catch (error) { finish(error) }
  })
}
