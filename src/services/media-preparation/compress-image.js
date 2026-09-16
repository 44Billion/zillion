import workerSource from './compress-image.worker.js?worker'

function run (message, temporary, { signal, onProgress }) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
    let worker; let ended = false
    const finish = (error, value) => {
      if (ended) return
      ended = true; worker?.terminate(); URL.revokeObjectURL(url)
      signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(value)
    }
    const abort = () => finish(signal.reason)
    try {
      worker = new Worker(url, { name: 'zillion-image-compression' })
      worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'IMAGE_COMPRESSION_FAILED')) }
      worker.onmessageerror = () => finish(new Error('IMAGE_COMPRESSION_FAILED'))
      worker.onmessage = async ({ data }) => {
        if (ended) return
        if (data.write) {
          try {
            await temporary.write(data.bytes, data.position)
            if (!ended) worker.postMessage({ ack: data.write })
          } catch (error) { finish(error) }
        } else if (data.progress !== undefined) onProgress?.({ phase: 'compress', progress: data.progress })
        else finish(data.error ? new Error(data.error) : null, data.result)
      }
      signal.addEventListener('abort', abort, { once: true })
      worker.postMessage(message)
    } catch (error) { finish(error) }
  })
}
export const compressMedia = (file, temporary, options) => run({ file }, temporary, options)
export const validateOutput = (file, expected, options) => run({ file, expected }, null, options)
