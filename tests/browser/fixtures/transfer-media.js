import { ensurePrivateMedia as ensure, cancelPrivateMedia as cancel, mediaState, observePrivateMedia, reportPrivateMedia } from '#services/private-media.js'
export { attachPrivateMediaTransport, rememberPrivateMediaEvent, privateMediaPeer, mediaState, observePrivateMedia, reportPrivateMedia } from '#services/private-media.js'

// This fixture's synthetic peer has controlled transfer notifications, not a
// real contact/channel. All actual chat media still uses the real transport.
const controlled = file => file?.peer === 'a'.repeat(64)
export function ensurePrivateMedia (file, options = {}) {
  if (!controlled(file)) return ensure(file, options)
  return new Promise((resolve, reject) => {
    const signal = options.signal
    const finish = error => { stop(); signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(file) }
    const abort = () => finish(signal.reason)
    const observe = state => {
      if (state?.peer !== file.peer || state?.root !== file.root) return
      if (state.status === 'complete') finish()
      else if (state.status === 'error') finish(new Error('FILE_UNAVAILABLE'))
      else if (state.status === 'cancelled') finish(new DOMException('Cancelled', 'AbortError'))
      else if (state.status === 'idle' && !options.manual) finish(new Error('FILE_DOWNLOAD_REQUIRES_ACTION'))
    }
    const stop = observePrivateMedia(observe)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    else observe(mediaState(file))
  })
}
export function cancelPrivateMedia (file) {
  if (!controlled(file)) return cancel(file)
  reportPrivateMedia({ ...file, status: 'cancelled' })
  return Promise.resolve()
}
