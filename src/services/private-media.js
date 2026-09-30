// mediaPeer is presentation context on a resolved reference. wireEvent strips
// it before persistence or publication; it never becomes a Nostr tag.
const listeners = new Set()
const states = new Map()
let transport
export function rememberPrivateMediaEvent (event, peer) {
  if (event?.kind === 1063 && /^[0-9a-f]{64}$/.test(peer || '')) return { ...event, mediaPeer: peer }
  return event
}
export const privateMediaPeer = event => event?.mediaPeer
export const mediaState = file => states.get(`${file?.peer}:${file?.root}`)
export function observePrivateMedia (listener) { listeners.add(listener); return () => listeners.delete(listener) }
export function reportPrivateMedia (state) {
  states.set(`${state.peer}:${state.root}`, state)
  for (const listener of listeners) listener(state)
}
export function attachPrivateMediaTransport (value) {
  transport ||= value
  return () => { if (transport === value) { transport = null; states.clear() } }
}
export async function ensurePrivateMedia (file, options = {}) {
  if (!file?.peer || !file.root) return
  if (!transport) throw new Error('CHAT_UNAVAILABLE')
  options.signal?.throwIfAborted()
  if (!mediaState(file) || ['idle', 'error', 'cancelled', 'paused'].includes(mediaState(file).status)) reportPrivateMedia({ ...file, status: 'checking' })
  const before = mediaState(file)
  try {
    const result = await transport.download(file, options)
    options.signal?.throwIfAborted()
    // Cached files and self-chat can complete without coordinator notifications.
    if (mediaState(file)?.status !== 'complete') reportPrivateMedia({ ...file, status: 'complete' })
    return result
  } catch (error) {
    if (!options.signal?.aborted && error.name !== 'AbortError' && mediaState(file) === before) {
      reportPrivateMedia({ ...file, status: error.message === 'FILE_DOWNLOAD_REQUIRES_ACTION' ? 'idle' : 'error' })
    }
    throw error
  }
}
export const cancelPrivateMedia = file => transport?.cancelDownload(file)

// Speculative preparation must never enter the download coordinator or emit
// transfer UI states. The local verifier also works before transport recovery.
export async function checkLocalPrivateMedia (file, { signal } = {}) {
  signal?.throwIfAborted()
  return file?.root && transport?.checkLocal ? transport.checkLocal(file, { signal }) : false
}
