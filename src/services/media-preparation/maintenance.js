import { sweepTemporaryOutputs } from './temporary-output.js'

const initialDelay = 2 * 60 * 1000
const interval = 30 * 60 * 1000
const retries = [10000, 60000, 300000]

// App lifetime, not route/account lifetime. Dependencies keep timing tests fast.
export function startTemporaryOutputMaintenance ({
  document: page = globalThis.document,
  sweep = sweepTemporaryOutputs,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  const controller = new AbortController()
  const first = now() + initialDelay
  let due = first; let notBefore = first; let timer; let running = false
  let attempted = false; let retry = 0; let stopped = false
  const visible = () => page.visibilityState === 'visible'
  const stop = () => {
    stopped = true
    clearTimer(timer)
    controller.abort()
    page.removeEventListener('visibilitychange', visibility)
  }
  const schedule = () => {
    clearTimer(timer)
    if (!stopped && !running && visible()) timer = setTimer(run, Math.max(0, due - now()))
  }
  const run = async () => {
    if (stopped || running) return
    if (!visible() || now() < due) { schedule(); return }
    running = true
    let result
    try { result = await sweep({ signal: controller.signal }) } catch { result = { failed: 1 } }
    running = false
    if (stopped) return
    if (result.status === 'unsupported') { stop(); return }
    attempted = true
    if (result.failed) {
      const delay = retries[retry] ?? interval
      retry = Math.min(retry + 1, retries.length)
      due = notBefore = now() + delay
    } else {
      retry = 0; notBefore = 0; due = now() + interval
    }
    schedule()
  }
  const visibility = () => {
    if (visible() && !running) due = attempted ? Math.max(now(), notBefore) : first
    schedule()
  }
  page.addEventListener('visibilitychange', visibility)
  schedule()
  return stop
}
