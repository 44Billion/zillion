import '#components/app.js'
import { f, useClosestStore, useStore } from '#f'
import { useInitChatLayout } from '#views/chat/hooks/use-chat-layout.js'
import { useInitI18n } from '#i18n/index.js'
import '#views/chat/message.js'

window.statusErrors = []
window.addEventListener('error', event => window.statusErrors.push(event.message))
window.addEventListener('unhandledrejection', event => window.statusErrors.push(String(event.reason)))

// Presentation controls only; the fixture does not replace injected APIs.
f('z-status-fixture', ({ h }) => {
  useInitI18n()
  useClosestStore('z-route-page', () => ({ isActive$: true }), { shouldCache: false })
  return h`<z-status-conversation />`
})

f('z-status-conversation', ({ h }) => {
  const page = useClosestStore('z-route-page')
  const view = useStore({
    timelineRef$: null, historyLoaded$: true, mounted$: true, activeId$: null,
    person$: { self: true },
    message$: { id: 'status-test', real: true, outgoing: true, text: '?', status: 'pending', time: '12:34 PM', date: 'Today', datetime: '2026-09-14T12:34:00Z' },
    messages$ () { return [this.message$()] }
  })
  const layout = useInitChatLayout(view.timelineRef$, view.historyLoaded$, () => {})
  window.__statusTest = { view, page, layout }
  return h`<main>
    <style>${`
      .status-timeline { width: 390px; max-width: 100%; height: 500px; overflow: auto; margin: auto; }
      .status-list { padding: 12px; margin: 0; }
    `}</style>
    <div class="status-timeline" ref=${view.timelineRef$}><div class="timeline-content"><ul class="status-list">
    ${view.mounted$() ? h`<z-chat-message props=${{ message$: view.message$, messages$: view.messages$, person$: view.person$, activeId$: view.activeId$, onReply: () => {}, onRetry: () => {} }} />` : null}
    </ul></div></div>
  </main>`
})
