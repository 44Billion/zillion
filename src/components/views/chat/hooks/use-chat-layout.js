import { useClosestStore, useMemo, useTask } from '#f'
import { useRoutePage } from '#shared/route-page.js'
import { createChatViewport } from '#helpers/chat-viewport.js'

export const useChatLayout = () => useClosestStore('z-chat-layout')

export function useInitChatLayout (timelineRef$, historyLoaded$, onScroll, messageCount$ = () => 0) {
  const page = useRoutePage()
  const runtime = useMemo(() => ({ controller: null }))
  const layout = useClosestStore('z-chat-layout', () => ({
    initial$: true,
    visible: element => runtime.controller?.visible(element) ?? false,
    reconcile: () => runtime.controller?.reconcile()
  }), { shouldCache: false })
  useTask(({ track, cleanup }) => {
    const timeline = track(() => timelineRef$())
    if (!timeline) return
    runtime.controller = createChatViewport(timeline, {
      active: page.isActive$(), historyLoaded: historyLoaded$(),
      onInitialChange: layout.initial$, onScroll, messageCount: messageCount$
    })
    cleanup(() => { runtime.controller.close(); runtime.controller = null })
  }, { after: 'rendering' })
  useTask(({ track }) => {
    const state = track(() => [page.isActive$(), historyLoaded$(), timelineRef$()])
    runtime.controller?.setState(state[0], state[1])
  }, { after: 'rendering' })
  return layout
}
