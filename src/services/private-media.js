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
  return transport.download(file, options)
}
export const cancelPrivateMedia = file => transport?.cancelDownload(file)
