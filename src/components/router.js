import Router from 'url-router'
import { f, useLocation } from '#f'
import '#f/components/f-route.js'

const router = new Router({
  '/': { path: '/', tag: 'z-home', loadModule: () => import('#views/home/index.js') },
  '/chat/:contactId': { path: '/chat/:contactId', tag: 'z-chat-route', loadModule: () => import('#views/chat/index.js') },
  '/(.*)': { path: '/(.*)', tag: 'z-chat-route', loadModule: () => import('#views/chat/index.js') }
})

f('z-router', ({ h }) => {
  useLocation(router)
  return h`
    <f-route props=${{ path: '/' }} />
    <f-route props=${{ paths: ['/chat/:contactId', '/(.*)'] }} />
  `
})
