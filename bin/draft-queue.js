// Only immutable build bytes enter this queue; network work never blocks esbuild.
export function createDraftQueue ({ publish, delayMs = 2000, onError = console.error }) {
  let timer
  let pending
  let running
  let stopped = false
  let eligible = false
  const pump = () => {
    if (stopped || running || !eligible || !pending) return
    const files = pending
    pending = null
    eligible = false
    running = Promise.resolve().then(() => publish(files)).catch(onError).finally(() => {
      running = null
      pump()
    })
  }
  const invalidate = () => { clearTimeout(timer); pending = null; eligible = false }
  return {
    invalidate,
    enqueue (files) {
      invalidate()
      if (stopped || !files) return
      pending = files
      timer = setTimeout(() => { eligible = true; pump() }, delayMs)
    },
    async close () { stopped = true; invalidate(); await running }
  }
}
