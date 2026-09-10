import { useTask } from '#f'

export function usePageTransition (view) {
  useTask(({ track, cleanup }) => {
    const [deck, navigation] = track(() => [view.deckRef$(), view.navigation$()])
    if (!deck || !navigation) return
    const pages = [...deck.querySelectorAll('.route-page')]
    let incoming
    const outgoing = pages.find(page => page.dataset.routeId === navigation.from)
    const mobile = matchMedia('(max-width: 718px)')
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
    let animation
    let stopped = false
    const finish = () => {
      stopped = true
      observer?.disconnect()
      animation?.cancel()
      outgoing?.removeAttribute('data-transitioning')
      incoming?.removeAttribute('data-transitioning')
    }
    const animate = navigation.direction !== 'none' && mobile.matches && !reducedMotion.matches
    if (animate && outgoing) outgoing.dataset.transitioning = ''
    // f-route imports lazily. Keep the old page until the incoming view exists.
    const start = () => {
      incoming = [...deck.querySelectorAll('.route-page')].find(page => page.dataset.routeId === navigation.to)
      if (stopped || !incoming?.querySelector('main')) return
      observer?.disconnect()
      if (navigation.from) incoming.querySelector('.route-scroll').focus({ preventScroll: true })
      if (!animate || !incoming.animate) { finish(); return }
      const backwards = navigation.direction === 'back' && outgoing
      const target = backwards ? outgoing : incoming
      target.dataset.transitioning = ''
      animation = target.animate(backwards
        ? [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }]
        : [{ transform: 'translateX(30%)', opacity: 0.55 }, { transform: 'translateX(0)', opacity: 1 }],
      { duration: 150, easing: 'ease', fill: 'both' })
      animation.finished.then(finish, () => {})
    }
    const observer = new MutationObserver(start)
    observer.observe(deck, { childList: true, subtree: true })
    start()
    mobile.addEventListener('change', finish)
    reducedMotion.addEventListener('change', finish)
    cleanup(() => {
      finish()
      mobile.removeEventListener('change', finish)
      reducedMotion.removeEventListener('change', finish)
    })
  }, { after: 'rendering' })
}
