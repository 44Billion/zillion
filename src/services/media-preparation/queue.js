// Serialize expensive jobs across composer, history, gallery and replies.
// Queued aborts reject promptly; the queue never starts overlapping decoders.
export function createMediaQueue () {
  let tail = Promise.resolve()
  return (run, signal) => {
    signal?.throwIfAborted()
    const work = tail.catch(() => {}).then(() => { signal?.throwIfAborted(); return run() })
    tail = work.catch(() => {})
    if (!signal) return work
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      if (signal.aborted) abort()
    })
  }
}
export const queueMedia = createMediaQueue()
