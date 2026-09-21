import { f, useStore, useTask } from '#f'
import { t } from '#i18n/messages.js'
import { useRoutePage } from '#shared/route-page.js'
import mediaCache from '#services/media-cache.js'
import avatarCache from '#services/avatar-cache.js'
import { acquireCachedAttachmentPreview } from '#services/attachment-previews.js'
import { useMediaDownload } from '#views/chat/hooks/use-media-download.js'
import { isOnline, onOnline } from 'libp2r2p/network'
import { prepareImage, preparationSignal } from '#helpers/media-dimensions.js'

f('z-viewer-item', ({ h, props }) => {
  const page = useRoutePage()
  const view = useStore({
    source$: null, failed$: false, loaded$: false, retry$: 0, videoRef$: null, imageRef$: null,
    playing$ () { return props.item$()?.type === 'video' && props.selected$() },
    imageSource$ () { return this.playing$() ? null : this.source$() },
    request$ () {
      const item = props.item$()
      return JSON.stringify([item?.id, item?.url, item?.type, item?.unavailable, page.isActive$(), this.playing$(), this.retry$()])
    }
  }, { shouldCache: false })
  const download = useMediaDownload(() => props.item$()?.url, () => view.failed$() && props.selected$(), () => props.item$()?.filename ?? '', () => props.item$() ?? {})
  useTask(({ track, cleanup }) => {
    track(() => view.request$())
    const item = props.item$()
    const active = page.isActive$()
    const play = view.playing$()
    const controller = new AbortController()
    cleanup(() => { controller.abort(); view.source$(null) })
    view.source$(null); view.failed$(Boolean(item?.unavailable)); view.loaded$(false)
    if (!active || !item?.url) return
    const { url, type } = item
    if (type === 'video' && !play) {
      const preview = acquireCachedAttachmentPreview(item, { signal: controller.signal })
      if (preview) { view.source$(preview.source); cleanup(preview.close) }
      return
    }
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
  // Setting sources in tasks also clears detached nodes cached by the template
  // engine. Removing them from the rendered branch alone does not release them.
  useTask(({ track, cleanup }) => {
    const [image, source, active] = track(() => [view.imageRef$(), view.imageSource$(), page.isActive$()])
    if (!image || !source || !active) return
    image.src = source
    cleanup(() => { image.removeAttribute('src'); image.removeAttribute('srcset') })
  }, { after: 'rendering' })
  useTask(({ track, cleanup }) => {
    const [video, source, active, selected] = track(() => [view.videoRef$(), view.source$(), page.isActive$(), view.playing$()])
    if (!video || !source || !active || !selected || props.item$()?.type !== 'video') return
    const startTime = props.startTime$()
    const seek = () => { if (startTime > 0) video.currentTime = Math.min(startTime, Number.isFinite(video.duration) ? video.duration : startTime) }
    video.addEventListener('loadedmetadata', seek, { once: true })
    video.src = source
    cleanup(() => { video.removeEventListener('loadedmetadata', seek); video.pause(); video.removeAttribute('src'); video.removeAttribute('poster'); video.load() })
  }, { after: 'rendering' })
  const item = props.item$()
  const selected = props.selected$()
  return h`
    <div class=${item ? 'viewer-asset' : 'viewer-empty'} data-current=${String(selected)} data-media-id=${item?.id ?? ''} ?hidden=${!item || !selected} data-loaded=${String(view.loaded$())}>
      <img ref=${view.imageRef$} ?hidden=${!view.source$() || view.failed$() || (item?.type === 'video' && selected)} alt=${item?.alt || item?.caption || ''} draggable="false" referrerpolicy="no-referrer" onload=${() => view.loaded$(true)} onerror=${() => view.failed$(true)}>
      <video ref=${view.videoRef$} ?hidden=${!view.source$() || view.failed$() || item?.type !== 'video' || !selected} ?controls=${selected && item?.type === 'video'} controlslist="nofullscreen" disablepictureinpicture playsinline preload="metadata" onloadeddata=${() => view.loaded$(true)} onerror=${() => view.failed$(true)}></video>
      ${view.failed$() ? h`<div class="viewer-state" role="status"><p>${t('Media unavailable')}</p><button type="button" onclick=${() => item?.unavailable ? props.retryMetadata() : view.retry$(value => value + 1)}>${t('Retry')}</button>${download.href$() ? h`<a href=${download.href$()} target=${download.target} download=${download.attribute$()} onclick=${download.click}>${t('Download file')}</a>` : null}</div>` : !view.loaded$() ? h`<div class="viewer-state loading" role="status">${t('Loading media')}</div>` : null}
    </div>
  `
})
