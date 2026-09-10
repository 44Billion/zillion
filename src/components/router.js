import Router from 'url-router'
import { f, useLocation, useStore, useTask } from '#f'
import { retainRoutePages, routePageId } from '#helpers/route-pages.js'
import { usePageTransition } from '#hooks/use-page-transition.js'
import '#shared/route-page.js'

const router = new Router({
  '/': { path: '/', tag: 'z-home', loadModule: () => import('#views/home/index.js') },
  '/chat/:contactId': { path: '/chat/:contactId', tag: 'z-chat-route', loadModule: () => import('#views/chat/index.js') },
  '/(.*)': { path: '/(.*)', tag: 'z-chat-route', loadModule: () => import('#views/chat/index.js') }
})

f('z-router', ({ h }) => {
  const location = useLocation(router)
  const view = useStore(() => ({
    deckRef$: null,
    pages$: retainRoutePages([], location.route$(), location.uidCounter$()),
    previous: location.route$(),
    navigation$: null
  }), { shouldCache: false })
  useTask(({ track }) => {
    const route = track(() => location.route$())
    const previous = view.previous
    const from = routePageId(previous)
    const to = routePageId(route)
    view.pages$(pages => retainRoutePages(pages, route, location.uidCounter$()))
    view.navigation$({
      from: from === to ? null : from,
      to,
      direction: route.uid === previous.uid ? 'none' : route.uid < previous.uid ? 'back' : 'forward'
    })
    view.previous = route
  })
  usePageTransition(view)
  return h`
    <div class="route-deck" ref=${view.deckRef$}>
      <style>${`
        z-router .route-deck { position: fixed; inset: 0; overflow: hidden; background: var(--z-canvas); }
        z-router .route-page {
          position: absolute; inset: 0; max-width: var(--z-mobile-width); margin-inline: auto;
          background: var(--z-canvas); visibility: hidden; pointer-events: none;
        }
        z-router .route-page[data-active=true] { visibility: visible; pointer-events: auto; }
        z-router .route-page[data-transitioning] { visibility: visible; z-index: 1; }
        z-router .route-page[data-active=true][data-transitioning] { z-index: 2; }
        z-router .route-scroll { position: absolute; inset: 0; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: none; outline: none; }
        z-router .route-scroll::-webkit-scrollbar { display: none; }
      `}</style>
      ${view.pages$().map(page => h({ key: page.mountKey })`<z-route-page props=${{ id: page.id }} />`)}
    </div>
  `
})
