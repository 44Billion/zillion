import { createPrivateFileTransfer } from 'libp2r2p/private-messenger/file'

const keyOf = file => `${file.controlChannelPubkey}:${file.root}`
const working = status => ['queued', 'starting', 'downloading'].includes(status)

// The coordinator's useful-byte progress includes verified cache hits. Observe
// its existing storage reads to distinguish local checking from missing bytes;
// validation, storage, requests and cancellation remain owned by the library.
export function createMediaTransferPresentation (options) {
  const storage = options.storage
  if (!storage) return createPrivateFileTransfer(options)
  const states = new Map()
  const listeners = new Set()
  const present = entry => working(entry.state.status) && !entry.missing
    ? { ...entry.state, status: 'checking' }
    : entry.state
  const emit = entry => { for (const listener of listeners) listener(present(entry)) }
  const transfer = createPrivateFileTransfer({
    ...options,
    storage: {
      async read (root, index, file) {
        const event = await storage.read(root, index, file)
        const entry = states.get(keyOf(file || { root }))
        if (!event && entry && working(entry.state.status) && !entry.missing) {
          entry.missing = true
          emit(entry)
        }
        return event
      },
      save: (...args) => storage.save(...args),
      ...(storage.reserve ? { reserve: (...args) => storage.reserve(...args) } : {}),
      ...(storage.stream ? { stream: (...args) => storage.stream(...args) } : {})
    }
  })
  const stop = transfer.observe(state => {
    const key = keyOf(state)
    const entry = { state, missing: state.status !== 'queued' && (states.get(key)?.missing || false) }
    states.set(key, entry)
    emit(entry)
  })
  return {
    ...transfer,
    async download (file, options) {
      try { return await transfer.download(file, options) } catch (error) {
        // The automatic size gate checks local bytes without creating a job.
        if (error.message === 'FILE_DOWNLOAD_REQUIRES_ACTION') {
          const entry = { state: { ...file, status: 'idle', completed: 0, total: file.size }, missing: true }
          states.set(keyOf(file), entry)
          emit(entry)
        }
        throw error
      }
    },
    observe (listener) {
      listeners.add(listener)
      for (const entry of states.values()) listener(present(entry))
      return () => listeners.delete(listener)
    },
    async close () { stop(); listeners.clear(); states.clear(); await transfer.close() }
  }
}
