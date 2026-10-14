import { f, useStore, useTask } from '#f'
import { useRoutePage } from '#shared/route-page.js'
import { useChatLayout } from '#views/chat/hooks/use-chat-layout.js'
import { useInitChatReadState } from '#views/chat/hooks/use-chat-read-state.js'
import './route-driver.js'

// Exercise the real read hook against the rendered chat and native observers.
// Only the read sink is controlled; no launcher API or permission is replaced.
f('z-chat-read-probe', ({ h }) => {
  const page = useRoutePage()
  const layout = useChatLayout()
  const view = useStore({ elementRef$: null, timelineRef$: null, enabled$: false })
  window.chatReadProbe = view
  window.chatReadCalls = []
  useTask(({ track }) => {
    const element = track(() => view.elementRef$())
    if (element) view.timelineRef$(element.closest('.chat-timeline'))
  }, { after: 'rendering' })
  useInitChatReadState({
    readAnchors$: () => ({}),
    advanceReadAnchor: (peer, anchor) => window.chatReadCalls.push(anchor)
  }, {
    peer$: () => 'b'.repeat(64), self$: () => false,
    messages$: () => [{ id: 'read-target', created_at: 1 }],
    timelineRef$: view.timelineRef$,
    active$: () => page.isActive$() && view.enabled$(),
    settled$: () => !layout.initial$(),
    viewportInsets$: layout.viewportInsets$, readable: layout.readable,
    dividerId$: () => null
  })
  return h`<span hidden ref=${view.elementRef$}></span>`
})
