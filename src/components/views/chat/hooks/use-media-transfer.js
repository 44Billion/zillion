import { useStore, useTask } from '#f'
import { ensurePrivateMedia, cancelPrivateMedia, mediaState, observePrivateMedia } from '#services/private-media.js'
import { useRoutePage } from '#shared/route-page.js'

export function useMediaTransfer (file$, enabled$ = () => true) {
  const page = useRoutePage()
  const view = useStore({
    state$: null,
    start (event) { event?.stopPropagation(); return ensurePrivateMedia(file$(), { manual: true }).catch(() => {}) },
    cancel (event) { event?.stopPropagation(); cancelPrivateMedia(file$())?.catch(() => {}) }
  })
  useTask(({ track, cleanup }) => {
    const key = track(() => `${file$()?.peer}:${file$()?.root}`)
    view.state$(mediaState(file$()) || null)
    cleanup(observePrivateMedia(state => { if (`${state.peer}:${state.root}` === key) view.state$(state) }))
  })
  useTask(({ track, cleanup }) => {
    const [file, active, enabled] = track(() => [file$(), page.isActive$(), enabled$()])
    if (!active || !enabled || !file?.peer || !file.root) return
    const controller = new AbortController()
    cleanup(() => controller.abort())
    ensurePrivateMedia(file, { signal: controller.signal }).then(() => {
      // Self-chat/local sends can resolve without a transport notification.
      if (!controller.signal.aborted && !mediaState(file)) view.state$({ status: 'complete' })
    }).catch(error => {
      if (!controller.signal.aborted && !mediaState(file)) {
        view.state$({ status: error.message === 'FILE_DOWNLOAD_REQUIRES_ACTION' ? 'idle' : 'error' })
      }
    })
  }, { when: 'visible', rootMargin: '0px' })
  return view
}
