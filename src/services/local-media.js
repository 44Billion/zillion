import { createMediaQueue } from './media-preparation/queue.js'

// The public chunk adapter verifies proofs, ordering, completeness and size in
// its stream. Share that local check across bubble, viewer and native download;
// neither contact discovery nor network/session recovery is needed to read it.
export function createLocalMediaAccess (storage) {
  const pending = new Map()
  const verified = new Set()
  const queues = [createMediaQueue(), createMediaQueue()]
  let next = 0
  const keyOf = file => `${file.root}:${file.size ?? ''}`
  const remember = file => {
    verified.add(keyOf(file))
    if (verified.size > 128) verified.delete(verified.values().next().value)
  }
  async function check (file, { signal } = {}) {
    signal?.throwIfAborted()
    if (!storage?.stream) return false
    const key = keyOf(file)
    if (verified.has(key)) return true
    let entry = pending.get(key)
    if (!entry) {
      const controller = new AbortController()
      entry = { controller, consumers: 0 }
      entry.work = queues[next++ % queues.length](async () => {
        try {
          // Consume with bounded memory; only a full verified stream is a hit.
          for await (const _ of storage.stream(file, { signal: controller.signal })) controller.signal.throwIfAborted()
          controller.signal.throwIfAborted()
          remember(file)
          return true
        } catch (error) {
          controller.signal.throwIfAborted()
          if (error.message === 'FILE_UNAVAILABLE') return false
          throw error
        }
      }, controller.signal).finally(() => { if (pending.get(key) === entry) pending.delete(key) })
      pending.set(key, entry)
    }
    entry.consumers++
    try {
      return await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal?.addEventListener('abort', abort, { once: true })
        entry.work.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort))
        if (signal?.aborted) abort()
      })
    } finally {
      if (--entry.consumers === 0 && pending.get(key) === entry) { pending.delete(key); entry.controller.abort() }
    }
  }
  return {
    check, remember,
    close () { for (const entry of pending.values()) entry.controller.abort(); pending.clear(); verified.clear() }
  }
}
