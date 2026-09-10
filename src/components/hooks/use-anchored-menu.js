import { useStore, useTask } from '#f'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'

// The installed f version does not export its floating hook. Use Floating UI's
// public API and let the mounted component own all observers and async work.
export function useAnchoredMenu ({ placement = 'bottom-end', gap = 8 } = {}) {
  const view = useStore(() => ({
    anchorRef$: null,
    floatingRef$: null,
    isOpen$: false,
    position$: null,
    isVisible$ () { return this.isOpen$() },
    floatingStyle$ () {
      const position = this.position$()
      return {
        position: 'fixed', left: `${position?.x ?? 0}px`, top: `${position?.y ?? 0}px`,
        visibility: position ? 'visible' : 'hidden'
      }
    },
    setIsOpen (value) { this.isOpen$(value) }
  }))
  useTask(({ track, cleanup }) => {
    const state = track(() => ({
      open: view.isOpen$(), anchor: view.anchorRef$(), floating: view.floatingRef$(),
      placement: typeof placement === 'function' ? placement() : placement
    }))
    if (!state.open || !state.anchor || !state.floating) { view.position$(null); return }
    let active = true
    let version = 0
    const update = async () => {
      const current = ++version
      const position = await computePosition(state.anchor, state.floating, {
        placement: state.placement, strategy: 'fixed',
        middleware: [offset(gap), flip({ padding: 8 }), shift({ padding: 8 })]
      })
      if (active && current === version) view.position$({ x: position.x, y: position.y })
    }
    const stop = autoUpdate(state.anchor, state.floating, update)
    cleanup(() => { active = false; stop() })
  }, { after: 'rendering' })
  return view
}
