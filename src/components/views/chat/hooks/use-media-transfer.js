import { useStore, useTask } from '#f'
import { ensurePrivateMedia, cancelPrivateMedia, mediaState, observePrivateMedia } from '#services/private-media.js'
import { useRoutePage } from '#shared/route-page.js'

export function useMediaTransfer (file$, enabled$ = () => true) {
  const page = useRoutePage()
  const view = useStore({
    state$: null,
    busy$ () { return ['queued', 'starting', 'downloading'].includes(this.state$()?.status) },
    percent$ () { const state = this.state$(); return state?.total ? Math.min(100, Math.floor(state.completed * 100 / state.total)) : 0 },
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
    ensurePrivateMedia(file, { signal: controller.signal }).catch(() => {})
  }, { when: 'visible', rootMargin: '0px' })
  return view
}
