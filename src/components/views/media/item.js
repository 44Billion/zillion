import { f, useStore, useTask } from '#f'
import { t } from '#i18n/messages.js'
import { useRoutePage } from '#shared/route-page.js'
import mediaCache from '#services/media-cache.js'
import avatarCache from '#services/avatar-cache.js'
import { isOnline, onOnline } from 'libp2r2p/network'
import { prepareImage, preparationSignal } from '#helpers/media-dimensions.js'

f('z-viewer-item', ({ h, props }) => {
  const page = useRoutePage()
  const view = useStore({ source$: null, failed$: false, loaded$: false, retry$: 0, videoRef$: null })
  useTask(({ track, cleanup }) => {
    const [url, type, active] = track(() => [props.item$()?.url, props.item$()?.type, page.isActive$()])
    track(() => view.retry$())
    const controller = new AbortController()
    cleanup(() => controller.abort())
    view.source$(null); view.failed$(false); view.loaded$(false)
    if (!active || !url) return
    let pending = false
    const resolve = async () => {
      if (pending || controller.signal.aborted || view.source$()) return
      pending = true
      try {
        const signal = preparationSignal(controller.signal)
        const local = new URL(url).origin === 'https://nostr.alt'
        const source = type === 'video'
          ? (local || await isOnline({ signal }) ? { source: url } : null)
          : props.photo
            ? await avatarCache.resolveImage(url, { signal })
            : local ? await prepareImage(url, { signal }) : await mediaCache.resolveImage(url, { signal })
        if (!controller.signal.aborted) { view.source$(source?.source ?? null); view.failed$(!source) }
      } catch { if (!controller.signal.aborted) view.failed$(true) } finally { pending = false }
    }
    const stop = onOnline(resolve)
    cleanup(stop)
    resolve()
  })
  useTask(({ track, cleanup }) => {
    const [video, source, active] = track(() => [view.videoRef$(), view.source$(), page.isActive$()])
    if (!video || !source || !active) return
    const seek = () => { if (props.startTime > 0) video.currentTime = Math.min(props.startTime, Number.isFinite(video.duration) ? video.duration : props.startTime) }
    video.addEventListener('loadedmetadata', seek, { once: true })
    video.src = source
    cleanup(() => { video.removeEventListener('loadedmetadata', seek); video.pause(); video.removeAttribute('src'); video.load() })
  }, { after: 'rendering' })
  const item = props.item$()
  if (!item) return null
  return h`
    <div class="viewer-asset" data-loaded=${String(view.loaded$())}>
      ${view.source$() && !view.failed$()
? item.type === 'video'
        ? h`<video ref=${view.videoRef$} controls controlslist="nofullscreen" disablepictureinpicture playsinline preload="metadata" onloadeddata=${() => view.loaded$(true)} onerror=${() => view.failed$(true)}></video>`
        : h`<img src=${view.source$()} alt=${item.alt || item.caption || ''} draggable="false" referrerpolicy="no-referrer" onload=${() => view.loaded$(true)} onerror=${() => view.failed$(true)}>`
: null}
      ${view.failed$() ? h`<div class="viewer-state" role="status"><p>${t('Media unavailable')}</p><button type="button" onclick=${() => view.retry$(value => value + 1)}>${t('Retry')}</button></div>` : !view.loaded$() ? h`<div class="viewer-state loading" role="status">${t('Loading media')}</div>` : null}
    </div>
  `
})
