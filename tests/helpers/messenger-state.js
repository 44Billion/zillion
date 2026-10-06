// Attach the session's required observable state contract to transport stubs.
export function withMessengerState (messenger, { onStateChanged }) {
  const reasons = new Set()
  let closed = false
  let fingerprint
  const readStatus = () => ({ closed, paused: reasons.size > 0, pauseReasons: [...reasons].sort() })
  const notify = () => {
    const state = readStatus()
    const next = JSON.stringify(state)
    if (next === fingerprint) return
    fingerprint = next
    onStateChanged(state)
  }
  const { pause, resume, close } = messenger
  Object.assign(messenger, {
    readStatus,
    async pause (reason) { reasons.add(reason); notify(); return pause?.(reason) },
    async resume (reason) { reasons.delete(reason); notify(); return resume?.(reason) },
    async close () { closed = true; notify(); return close?.() }
  })
  notify()
  return messenger
}
