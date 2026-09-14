import { useStore, useTask } from '#f'
import { useRoutePage } from '#shared/route-page.js'
import { useChatLayout } from './use-chat-layout.js'

export function useMessageGrowth () {
  const page = useRoutePage()
  const layout = useChatLayout()
  const view = useStore({ outerRef$: null, innerRef$: null })
  useTask(({ track, cleanup }) => {
    const { outer, inner, active } = track(() => ({ outer: view.outerRef$(), inner: view.innerRef$(), active: page.isActive$() }))
    if (!outer || !inner || !active) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let height = inner.getBoundingClientRect().height
    let viewportWidth = window.innerWidth
    let viewportHeight = window.visualViewport?.height ?? window.innerHeight
    let enriched = false
    let statusChanged = false
    let statusFrame = 0
    let animation
    const stop = () => {
      animation?.cancel(); animation = null; outer.style.overflow = ''
      if (outer.style.height) outer.style.height = statusFrame ? `${height}px` : ''
    }
    const statusTick = () => {
      statusFrame = 0
      resize(true)
      if (inner.querySelector('.message-status')?.getAnimations().length) statusFrame = requestAnimationFrame(statusTick)
      else outer.style.height = ''
    }
    const mutations = new MutationObserver(records => {
      for (const record of records) {
        if (record.target.parentElement?.closest('.message-status') || record.target.matches?.('.message-status')) statusChanged = true
        else enriched = true
      }
      const status = inner.querySelector('.message-status')
      // Width interpolation can cross a line boundary between two observer
      // deliveries. Prepare its height in rAF, before observers run, so starting
      // the height animation does not invalidate an already-observed ancestor.
      if (!statusFrame && status?.dataset.widthChange === 'grow' && status.getAnimations().length) {
        outer.style.height = `${animation ? outer.getBoundingClientRect().height : height}px`
        statusFrame = requestAnimationFrame(statusTick)
      } else if (statusFrame && status?.dataset.widthChange === 'instant') settle()
    })
    mutations.observe(inner, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style', 'width', 'height', 'hidden'] })
    const resize = (preflight = false) => {
      // The held outer height protects the current frame if intrinsic reflow
      // lands after rAF. Its next update belongs to preflight, not RO delivery.
      if (!preflight && statusFrame) return
      const next = inner.getBoundingClientRect().height
      const width = window.innerWidth
      const viewport = window.visualViewport?.height ?? window.innerHeight
      const resized = width !== viewportWidth || viewport !== viewportHeight
      viewportWidth = width
      viewportHeight = viewport
      // Width animation can resize this box every frame without changing its
      // height. Those notifications must not cancel an ongoing height animation.
      if (!resized && Math.abs(next - height) < 0.1) { enriched = false; statusChanged = false; return }
      const from = animation ? outer.getBoundingClientRect().height : height
      const wasAnimating = !!animation
      const status = inner.querySelector('.message-status')
      const statusGrowth = status?.dataset.widthChange === 'grow' && (statusChanged || status.getAnimations().length > 0)
      const animate = (enriched || statusGrowth) && !resized && !layout.initial$() && !reduced.matches && layout.visible(outer) && Math.abs(next - height) > 0.5
      enriched = false
      statusChanged = false
      height = next
      stop()
      if (animate) {
        outer.style.overflow = 'clip'
        animation = outer.animate([{ height: `${from}px` }, { height: `${next}px` }], { duration: 150, easing: 'ease-out' })
        const current = animation
        animation.finished.then(() => { if (animation === current) { stop(); layout.reconcile() } }, () => {})
      }
      if (animate || wasAnimating) layout.reconcile()
    }
    const observer = new ResizeObserver(() => resize())
    observer.observe(inner)
    const settle = () => { cancelAnimationFrame(statusFrame); statusFrame = 0; stop() }
    reduced.addEventListener('change', settle)
    window.addEventListener('resize', settle)
    window.visualViewport?.addEventListener('resize', settle)
    cleanup(() => {
      observer.disconnect()
      mutations.disconnect()
      reduced.removeEventListener('change', settle)
      window.removeEventListener('resize', settle)
      window.visualViewport?.removeEventListener('resize', settle)
      settle()
    })
  }, { after: 'rendering' })
  return view
}
