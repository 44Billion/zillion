import { createPrivateMessageSession } from 'libp2r2p/private-messenger/session'
import { createEventStoreChunkStorage, createPersonalCopyRecoveryStorage } from 'libp2r2p/private-messenger/event-store'
import { attachPrivateMediaTransport, reportPrivateMedia } from './private-media.js'
import { createMediaTransferPresentation } from './media-transfer-presentation.js'
import { createChatOutbox } from './chat-outbox.js'
import { createLocalMediaAccess } from './local-media.js'
export { wireEvent } from 'libp2r2p/private-messenger/session'

export function createPrivateChats (options) {
  const recovery = options.recoveryStorage === undefined
    ? createPersonalCopyRecoveryStorage({ eventStore: options.eventStore, signer: options.signer })
    : options.recoveryStorage
  const chunkStorage = options.chunkStorage || (options.eventStore ? createEventStoreChunkStorage({ eventStore: options.eventStore }) : undefined)
  const local = createLocalMediaAccess(chunkStorage)
  const session = createPrivateMessageSession({
    ...options,
    chunkStorage,
    FileTransfer: options.FileTransfer || createMediaTransferPresentation,
    recoveryStorage: recovery,
    openOutbox: options.openOutbox || createChatOutbox,
    openDownloads: options.openDownloads || (value => createChatOutbox({ ...value, namespace: 'downloads' })),
    onMedia: reportPrivateMedia
  })
  const lifetime = new AbortController()
  const pending = new Set()
  const waiters = new Set()
  const waitingDownloads = new Map()
  let peersKnown = false
  let available
  let latest
  let failure
  const notify = () => { for (const wake of waiters) wake(); waiters.clear() }
  const track = work => {
    latest = work
    failure = null
    pending.add(work)
    notify()
    return work.catch(error => { if (latest === work) failure = error; throw error }).finally(() => { pending.delete(work); notify() })
  }
  const wait = signal => new Promise((resolve, reject) => {
    const finish = () => { waiters.delete(finish); signal.removeEventListener('abort', finish); if (signal.aborted) reject(signal.reason); else resolve() }
    waiters.add(finish)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
  const transport = {
    ...session,
    setPeers (peers) { peersKnown = true; return track(session.setPeers(peers)) },
    setAvailable (value) { available = value === true; return track(session.setAvailable(value)) },
    setState (state) { return transport.setAvailable(state.access === 'allowed' && state.connection === 'connected' && state.isLocked === false && state.isReadOnly === false) },
    async download (file, request = {}) {
      if (file.peer === options.owner) return session.download(file, request)
      const key = `${file.peer}:${file.root}`
      const controller = new AbortController()
      const signal = AbortSignal.any([lifetime.signal, controller.signal, ...(request.signal ? [request.signal] : [])])
      const waiting = waitingDownloads.get(key) || new Set()
      waitingDownloads.set(key, waiting)
      waiting.add(controller)
      try {
        signal.throwIfAborted()
        if (available === false) throw new Error('CHAT_UNAVAILABLE')
        if (await local.check(file, { signal })) return file
        // Only missing bytes need contact authorization and session readiness.
        // Local originals must stay usable throughout remote recovery.
        while (true) {
          signal.throwIfAborted()
          if (available === false) throw new Error('CHAT_UNAVAILABLE')
          if (!pending.size && failure) throw failure
          if (available && peersKnown && !pending.size) break
          await wait(signal)
        }
      } finally {
        waiting.delete(controller)
        if (!waiting.size) waitingDownloads.delete(key)
      }
      const result = await session.download(file, { ...request, signal })
      signal.throwIfAborted()
      local.remember(file)
      return result
    },
    cancelDownload (file) {
      const waiting = waitingDownloads.get(`${file.peer}:${file.root}`)
      if (waiting?.size) {
        for (const controller of waiting) controller.abort()
        reportPrivateMedia({ ...file, status: 'cancelled' })
      }
      return session.cancelDownload(file)
    },
    async close () { lifetime.abort(); local.close(); detach(); await session.close(); if (options.recoveryStorage === undefined) await recovery?.close() }
  }
  const detach = attachPrivateMediaTransport(transport)
  return transport
}
