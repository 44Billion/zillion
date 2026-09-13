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
    let animation
    const stop = () => { animation?.cancel(); animation = null; outer.style.overflow = '' }
    const mutations = new MutationObserver(() => { enriched = true })
    mutations.observe(inner, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style', 'width', 'height', 'hidden'] })
    const observer = new ResizeObserver(() => {
      const next = inner.getBoundingClientRect().height
      const width = window.innerWidth
      const viewport = window.visualViewport?.height ?? window.innerHeight
      const resized = width !== viewportWidth || viewport !== viewportHeight
      viewportWidth = width
      viewportHeight = viewport
      const from = animation ? outer.getBoundingClientRect().height : height
      const wasAnimating = !!animation
      const animate = enriched && !resized && !layout.initial$() && !reduced.matches && layout.visible(outer) && Math.abs(next - height) > 0.5
      enriched = false
      height = next
      stop()
      if (animate) {
        outer.style.overflow = 'clip'
        animation = outer.animate([{ height: `${from}px` }, { height: `${next}px` }], { duration: 150, easing: 'ease-out' })
        const current = animation
        animation.finished.then(() => { if (animation === current) { stop(); layout.reconcile() } }, () => {})
      }
      if (animate || wasAnimating) layout.reconcile()
    })
    observer.observe(inner)
    reduced.addEventListener('change', stop)
    window.addEventListener('resize', stop)
    window.visualViewport?.addEventListener('resize', stop)
    cleanup(() => {
      observer.disconnect()
      mutations.disconnect()
      reduced.removeEventListener('change', stop)
      window.removeEventListener('resize', stop)
      window.visualViewport?.removeEventListener('resize', stop)
      stop()
    })
  }, { after: 'rendering' })
  return view
}
