import { useStore, useTask } from '#f'
import { useRoutePage } from '#shared/route-page.js'
import { useChatLayout } from './use-chat-layout.js'

export function useStatusWidth () {
  const page = useRoutePage()
  const layout = useChatLayout()
  const view = useStore({ outerRef$: null, innerRef$: null })
  useTask(({ track, cleanup }) => {
    const { outer, inner, active } = track(() => ({ outer: view.outerRef$(), inner: view.innerRef$(), active: page.isActive$() }))
    if (!outer || !inner || !active) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let width = inner.getBoundingClientRect().width
    let status = outer.dataset.status
    let animation
    const stop = () => {
      animation?.cancel()
      animation = null
      outer.style.overflow = ''
    }
    const update = () => {
      const changed = status !== outer.dataset.status
      status = outer.dataset.status
      const next = inner.getBoundingClientRect().width
      if (Math.abs(next - width) < 0.1) return
      const from = animation ? outer.getBoundingClientRect().width : width
      width = next
      stop()
      const grow = changed && next > from && !layout.initial$() && !reduced.matches && layout.visible(outer)
      outer.dataset.widthChange = grow ? 'grow' : 'instant'
      if (grow) {
        outer.style.overflow = 'clip'
        animation = outer.animate([{ width: `${from}px` }, { width: `${next}px` }], { duration: 150, easing: 'ease-out' })
        const current = animation
        animation.finished.then(() => { if (animation === current) { stop(); layout.reconcile() } }, () => {})
      }
      layout.reconcile()
    }
    // Read the new intrinsic width before the parent's ResizeObserver sees a
    // final-state reflow. Observe the inner box, never the animated width.
    const mutations = new MutationObserver(update)
    mutations.observe(outer, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-status'] })
    const observer = new ResizeObserver(update)
    observer.observe(inner)
    const settle = () => { outer.dataset.widthChange = 'instant'; stop(); width = inner.getBoundingClientRect().width }
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
