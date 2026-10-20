// Gate only the UI's requests for older pages. Storage, decryption, permissions
// and the history service are real; a released request runs the original method.
export function controlHistoryPaging (account) {
  const original = account.loadOlder
  let armed = false
  let waiting = null
  let running = null
  const controlled = () => {
    if (running) return running
    if (!armed) return Promise.resolve(false)
    waiting ??= Promise.withResolvers()
    return waiting.promise
  }
  account.loadOlder = controlled
  return {
    get pending () { return !!waiting },
    arm () { armed = true },
    release () {
      if (!waiting) throw new Error('No viewport pagination request is waiting')
      const request = waiting
      waiting = null
      armed = false
      running = Promise.resolve().then(() => original.call(account))
      running.then(request.resolve, request.reject).finally(() => { running = null })
      return request.promise
    },
    next: () => original.call(account),
    restore () {
      armed = false
      waiting?.resolve(false)
      waiting = null
      if (account.loadOlder === controlled) account.loadOlder = original
    }
  }
}

// Synchronize with DOM insertion, native scroll events and ResizeObserver, not
// elapsed wall time. Requiring repeated equal geometry also catches late renders.
export async function settleHistoryLayout () {
  await document.fonts.ready
  let previous
  let stable = 0
  for (let frame = 0; frame < 180; frame++) {
    await new Promise(resolve => requestAnimationFrame(resolve))
    const timeline = document.querySelector('.route-page[data-active=true] .chat-timeline')
    const rows = [...timeline.querySelectorAll('[data-message-id]')]
    const geometry = JSON.stringify([
      timeline.scrollTop, timeline.scrollHeight, timeline.clientHeight,
      ...rows.flatMap(row => { const box = row.getBoundingClientRect(); return [row.dataset.messageId, box.top, box.height] })
    ])
    const ready = rows.length === window.selfChatAccount.messages$().length &&
      timeline.dataset.initialLoading === 'false' && !timeline.getAnimations({ subtree: true }).length
    stable = ready && geometry === previous ? stable + 1 : 0
    if (stable >= 4) return
    previous = geometry
  }
  throw new Error('History viewport did not settle within 180 animation frames')
}
