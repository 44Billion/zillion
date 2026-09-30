import { useStore, useTask } from '#f'
import { useRoutePage } from '#shared/route-page.js'
import { demoEnabled } from '#services/demo.js'

export function useConversationPrefetch (account, view) {
  const page = useRoutePage()
  const state = useStore({
    order$ () {
      const signer = account.signerState$()
      if (demoEnabled || !page.isActive$() || !account.ready$() || signer?.connection !== 'connected' || signer.isLocked || account.contactsState$() !== 'loaded') return ''
      const summaries = account.summaries$()
      const peers = [account.pubkey$(), ...account.contacts$().map(contact => contact.pubkey)]
      if (!peers.every(peer => summaries[peer]?.state === 'loaded')) return ''
      return view.conversations$().filter(row => row.real && row.lastMessageAt).map(row => row.contact.pubkey).join(',')
    }
  })
  useTask(({ track, cleanup }) => {
    const [home, order] = track(() => [view.homeRef$(), state.order$()])
    if (!home || !order) return
    const scroller = home.closest('.route-scroll')
    const peers = new Set(order.split(','))
    let timer
    const measure = () => {
      if (document.hidden) return
      const viewport = scroller.getBoundingClientRect()
      // The header and divider are sticky; rows underneath them are obscured.
      const top = Math.max(0, viewport.top, home.querySelector('.home-header').getBoundingClientRect().bottom, home.querySelector('.contacts-divider').getBoundingClientRect().bottom)
      const bottom = Math.min(window.innerHeight, viewport.bottom)
      const left = Math.max(0, viewport.left)
      const right = Math.min(window.innerWidth, viewport.right)
      const visible = [...home.querySelectorAll('[data-prefetch-peer]')].filter(row => {
        const rect = row.getBoundingClientRect()
        return peers.has(row.dataset.prefetchPeer) && rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right
      }).map(row => row.dataset.prefetchPeer)
      account.prefetchConversations(visible)
    }
    const schedule = () => {
      clearTimeout(timer)
      account.prefetchConversations([])
      if (!document.hidden) timer = setTimeout(measure, 250)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(home)
    observer.observe(scroller)
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    document.addEventListener('visibilitychange', schedule)
    schedule()
    cleanup(() => {
      clearTimeout(timer)
      observer.disconnect()
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', schedule)
      account.prefetchConversations([])
    })
  }, { after: 'rendering' })
}
