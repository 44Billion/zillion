import { useMemo, useTask } from '#f'
import { compareChatMessages } from '#helpers/conversation-preview.js'
import { createOutgoingReads } from '#services/read-state.js'

const DWELL_MS = 2000
const READ_VISIBILITY = 0.5
// The frozen marker only disappears once it is clearly above the visible
// content area, not while it still hugs the header edge.
const DISMISS_MARGIN = 24
const DISMISS_MS = 180

// Collapse the divider to zero height before removing it so the messages below
// slide up instead of jumping. Returns a cancel function for unmounts.
function collapseDivider (element, done) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    done()
    return () => {}
  }
  const style = getComputedStyle(element)
  const box = element.getBoundingClientRect()
  element.style.boxSizing = 'border-box'
  element.style.overflow = 'hidden'
  element.style.height = `${box.height}px`
  element.style.marginTop = style.marginTop
  element.style.marginBottom = style.marginBottom
  element.style.paddingTop = style.paddingTop
  element.style.paddingBottom = style.paddingBottom
  element.style.transition = [
    `height ${DISMISS_MS}ms ease`,
    `margin-top ${DISMISS_MS}ms ease`,
    `margin-bottom ${DISMISS_MS}ms ease`,
    `padding-top ${DISMISS_MS}ms ease`,
    `padding-bottom ${DISMISS_MS}ms ease`,
    `opacity ${DISMISS_MS}ms ease`
  ].join(', ')
  // Commit the starting box before collapsing it.
  element.getBoundingClientRect()
  element.style.height = '0px'
  element.style.marginTop = '0px'
  element.style.marginBottom = '0px'
  element.style.paddingTop = '0px'
  element.style.paddingBottom = '0px'
  element.style.opacity = '0'
  let cancelled = false
  const finish = () => {
    if (cancelled) return
    cancelled = true
    clearTimeout(timer)
    element.removeEventListener('transitionend', onEnd)
    done()
  }
  const onEnd = event => {
    if (event.target === element && event.propertyName === 'height') finish()
  }
  element.addEventListener('transitionend', onEnd)
  const timer = setTimeout(finish, DISMISS_MS + 80)
  return () => {
    cancelled = true
    clearTimeout(timer)
    element.removeEventListener('transitionend', onEnd)
  }
}

// Marks the newest message the reader actually dwelled on as read. The anchor
// only moves while the route is active and the document is visible, and the
// debounced write is flushed when leaving the route or the page.
export function useInitChatReadState (account, view) {
  const runtime = useMemo(() => ({ visible: new Set(), timers: new Map(), prioritized: false, outgoing: createOutgoingReads() }))
  const flush = () => {
    const peer = view.peer$()
    if (/^[0-9a-f]{64}$/i.test(peer || '')) account.flushReadState?.(peer)
  }
  // The prioritized recovery lane warms the window that starts at the anchor.
  useTask(({ track }) => {
    const [peer, self, active, timeline, anchors] = track(() => [view.peer$(), view.self$(), view.active$(), view.timelineRef$(), account.readAnchors$?.() ?? {}])
    if (!active) { runtime.prioritized = false; return }
    if (!timeline || self || !/^[0-9a-f]{64}$/i.test(peer || '')) return
    const anchor = anchors[peer] ?? account.readAnchor?.(peer) ?? null
    if (!anchor || runtime.prioritized) return
    runtime.prioritized = true
    account.prioritizeRange?.(peer, { since: anchor.created_at, type: 'unread-page' })
  }, { after: 'rendering' })
  useTask(({ track, cleanup }) => {
    const timeline = track(() => view.timelineRef$())
    const peer = track(() => view.peer$())
    const self = track(() => view.self$())
    track(() => view.active$())
    // Dwell only counts after the viewport settled (anchored open included);
    // pages rendered while the anchor window is still loading must not mark the
    // recent snapshot as read.
    track(() => view.settled$())
    if (!timeline || self || !/^[0-9a-f]{64}$/i.test(peer || '')) return
    const visible = runtime.visible = new Set()
    const timers = runtime.timers = new Map()
    const allowed = () => view.settled$() && view.active$() && document.visibilityState !== 'hidden'
    const stop = id => {
      const timer = timers.get(id)
      if (!timer) return
      clearTimeout(timer)
      timers.delete(id)
    }
    const stopAll = () => { for (const id of [...timers.keys()]) stop(id) }
    const read = id => {
      timers.delete(id)
      if (!allowed()) return
      const message = view.messages$().find(item => item.id === id)
      if (!message) return
      account.advanceReadAnchor?.(peer, { id: message.id, created_at: message.created_at })
    }
    const start = id => {
      if (timers.has(id)) return
      timers.set(id, setTimeout(() => read(id), DWELL_MS))
    }
    const sync = () => {
      if (!allowed()) { stopAll(); return }
      for (const id of visible) start(id)
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = entry.target.dataset?.messageId
        if (!id) continue
        if (entry.isIntersecting && entry.intersectionRatio >= READ_VISIBILITY) {
          visible.add(id)
          if (allowed()) start(id)
        } else {
          visible.delete(id)
          stop(id)
        }
      }
    }, { root: timeline, threshold: [0, READ_VISIBILITY] })
    const observe = () => { for (const row of timeline.querySelectorAll('[data-message-id]')) observer.observe(row) }
    observe()
    const mutations = new MutationObserver(observe)
    mutations.observe(timeline, { subtree: true, childList: true })
    const visibility = () => { flush(); sync() }
    const pagehide = () => flush()
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', pagehide)
    cleanup(() => {
      observer.disconnect()
      mutations.disconnect()
      stopAll()
      visible.clear()
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', pagehide)
      flush()
    })
  }, { after: 'rendering' })
  // Own confirmed publications advance the anchor immediately, even when their
  // bubble is far from the viewport.
  useTask(({ track }) => {
    const peer = track(() => view.peer$())
    const self = track(() => view.self$())
    const messages = track(() => view.messages$())
    if (self || !/^[0-9a-f]{64}$/i.test(peer || '')) return
    for (const anchor of runtime.outgoing.published(messages)) account.advanceReadAnchor?.(peer, anchor)
  })
  // The divider never moves while the chat is open. It only disappears after a
  // newer message became read and scrolling left the marker above the visible
  // content area by a margin.
  useTask(({ track, cleanup }) => {
    const timeline = track(() => view.timelineRef$())
    const dividerId = track(() => view.dividerId$())
    const anchors = track(() => account.readAnchors$?.() ?? {})
    const peer = track(() => view.peer$())
    const active = track(() => view.active$())
    if (!timeline || !dividerId || !active || !/^[0-9a-f]{64}$/i.test(peer || '')) return
    const marker = view.messages$().find(item => item.id === dividerId)
    const anchor = anchors[peer] ?? null
    if (!marker || !anchor || compareChatMessages(anchor, marker) <= 0) return
    let frame = 0
    let cancelCollapse = null
    const check = () => {
      frame = 0
      if (!view.active$() || view.dividerId$() !== dividerId) return
      const divider = timeline.querySelector('[data-unread-divider]')
      if (!divider || cancelCollapse) return
      const padding = parseFloat(getComputedStyle(timeline).paddingTop) || 0
      const top = timeline.getBoundingClientRect().top + padding
      if (divider.getBoundingClientRect().bottom < top - DISMISS_MARGIN) {
        cancelCollapse = collapseDivider(divider, () => view.dismissDivider?.())
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check) }
    check()
    timeline.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    cleanup(() => {
      cancelCollapse?.()
      cancelAnimationFrame(frame)
      timeline.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    })
  }, { after: 'rendering' })
}
