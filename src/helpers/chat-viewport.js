// Own both bottom following and the reading anchor; native anchoring must not
// apply a second adjustment to the same layout change.
export function createChatViewport (timeline, { active = true, historyLoaded = false, onInitialChange = () => {}, onScroll = () => {} } = {}) {
  const content = timeline.querySelector('.timeline-content')
  const previousPadding = content.style.paddingTop
  let following = true
  let initial = true
  let anchor = null
  let expectedScroll = null
  let lastScroll = timeline.scrollTop
  let settleFrame = 0
  let revision = 0
  let touchY = null
  let dragging = false
  let inputPending = false
  let inputFrame = 0
  const previousAnchoring = timeline.style.overflowAnchor
  timeline.style.overflowAnchor = 'none'
  const gap = () => timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight
  const visible = (element, margin = 0) => {
    const box = element.getBoundingClientRect()
    const viewport = timeline.getBoundingClientRect()
    return box.bottom > viewport.top - margin && box.top < viewport.bottom + margin
  }
  const remember = () => {
    if (following) { anchor = null; return }
    const viewportTop = timeline.getBoundingClientRect().top
    const top = viewportTop + 60
    const element = [...timeline.querySelectorAll('[data-message-id]')].find(row => row.getBoundingClientRect().bottom > top)
    anchor = element ? { element, top: element.getBoundingClientRect().top - viewportTop } : null
  }
  const writeScroll = value => {
    timeline.scrollTop = value
    expectedScroll = timeline.scrollTop
    lastScroll = timeline.scrollTop
  }
  const pinBottom = () => {
    // Layout uses fractional CSS pixels, but scrolling snaps to device pixels.
    // Align the content's end using less than one pixel of leading space so
    // repeated prepends cannot shift the rasterized edges of unchanged bubbles.
    if (timeline.scrollHeight > timeline.clientHeight) {
      const scale = window.devicePixelRatio || 1
      const padding = parseFloat(getComputedStyle(content).paddingTop) || 0
      const top = parseFloat(getComputedStyle(timeline).paddingTop) || 0
      const end = top + content.getBoundingClientRect().height - padding
      const adjustment = Math.ceil(end * scale) / scale - end
      const value = `${Math.round(adjustment * 64) / 64}px`
      if (content.style.paddingTop !== value) content.style.paddingTop = value
    }
    writeScroll(timeline.scrollHeight)
  }
  const endInitial = () => {
    if (!initial) return
    initial = false
    timeline.dataset.initialLoading = 'false'
    onInitialChange(false)
  }
  const checkInitial = () => {
    cancelAnimationFrame(settleFrame)
    if (!initial || !active || !historyLoaded) return
    const currentRevision = revision
    // Give newly mounted visibility tasks and their signal updates two frames.
    settleFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        if (!active || !initial || revision !== currentRevision) return
        const pending = [...timeline.querySelectorAll('[data-chat-prepared="false"]')]
          .some(element => visible(element, timeline.clientHeight / 2))
        if (!pending) endInitial()
      })
    })
  }
  const reconcile = () => {
    if (!active) return
    if (following && !inputPending && !dragging) pinBottom()
    else if (!inputPending && !dragging && anchor?.element.isConnected) {
      const delta = anchor.element.getBoundingClientRect().top - timeline.getBoundingClientRect().top - anchor.top
      if (Math.abs(delta) > 0.1) writeScroll(timeline.scrollTop + delta)
    }
    remember()
    revision++
    checkInitial()
  }
  const scroll = () => {
    if (!active) return
    lastScroll = timeline.scrollTop
    const own = expectedScroll !== null && Math.abs(timeline.scrollTop - expectedScroll) < 1
    expectedScroll = null
    if (!own || inputPending || dragging) {
      following = gap() < 24
      if (!following) endInitial()
      onScroll()
    }
    inputPending = false
    remember()
    checkInitial()
  }
  const intent = away => {
    if (!active) return
    inputPending = true
    expectedScroll = null
    if (away && timeline.scrollHeight > timeline.clientHeight) {
      following = false
      endInitial()
    }
    remember()
    cancelAnimationFrame(inputFrame)
    inputFrame = requestAnimationFrame(() => {
      if (!active || dragging) return
      inputPending = false
      following = gap() < 24
      remember()
    })
  }
  const wheel = event => { if (event.deltaY) intent(event.deltaY < 0) }
  const touchstart = event => { touchY = event.touches[0]?.clientY }
  const touchmove = event => {
    const y = event.touches[0]?.clientY
    if (touchY != null && y !== touchY) intent(y > touchY)
    touchY = y
  }
  const keydown = event => {
    if (event.defaultPrevented) return
    if (event.target.closest('input, textarea, video, [contenteditable="true"]')) return
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      intent(['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey))
    }
  }
  const pointerdown = event => {
    const box = timeline.getBoundingClientRect()
    if (event.target === timeline && (event.clientX >= box.left + timeline.clientWidth || event.clientX < box.left + timeline.clientLeft)) {
      dragging = true
      intent(false)
    }
  }
  const pointerup = () => {
    if (!dragging) return
    dragging = false
    scroll()
  }
  const resize = new ResizeObserver(reconcile)
  resize.observe(timeline)
  resize.observe(content)
  const mutations = new MutationObserver(() => { revision++; checkInitial() })
  mutations.observe(timeline, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-chat-prepared'] })
  const listeners = { scroll, wheel, touchstart, touchmove, keydown, pointerdown }
  for (const [name, listener] of Object.entries(listeners)) timeline.addEventListener(name, listener, { passive: true })
  window.addEventListener('pointerup', pointerup)
  window.addEventListener('pointercancel', pointerup)
  timeline.dataset.initialLoading = 'true'
  reconcile()
  return {
    visible,
    reconcile,
    setState (nextActive, nextLoaded) {
      // Navigation may run before the browser dispatches the user's last scroll
      // event. Capture that position before suspending the retained page.
      if (active && !nextActive && Math.abs(timeline.scrollTop - lastScroll) > 0.5) {
        following = gap() < 24
        if (!following) endInitial()
        remember()
        lastScroll = timeline.scrollTop
      }
      active = nextActive
      historyLoaded = nextLoaded
      if (active) reconcile()
      else {
        cancelAnimationFrame(settleFrame)
        cancelAnimationFrame(inputFrame)
        inputPending = dragging = false
      }
    },
    close () {
      resize.disconnect()
      mutations.disconnect()
      cancelAnimationFrame(settleFrame)
      cancelAnimationFrame(inputFrame)
      for (const [name, listener] of Object.entries(listeners)) timeline.removeEventListener(name, listener)
      window.removeEventListener('pointerup', pointerup)
      window.removeEventListener('pointercancel', pointerup)
      timeline.style.overflowAnchor = previousAnchoring
      content.style.paddingTop = previousPadding
    }
  }
}
