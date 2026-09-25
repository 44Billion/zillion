import { useSignerRecovery, canRecoverSignerFailure } from '#hooks/use-signer-recovery.js'
import { mediaOpenHandlers } from '#helpers/media-open.js'
import '#shared/icons/icon-arrows-diagonal.js'
import { useMediaDownload } from './hooks/use-media-download.js'
import { f, useStore, useTask, useMemo } from '#f'
import { thumbHashToDataURL } from 'thumbhash'
import { base64ToBytes } from 'libp2r2p/base64'
import { t } from '#i18n/messages.js'
import { acquireAttachmentPreview, acquireCachedAttachmentPreview } from '#services/attachment-previews.js'
import { mediaDimensions, prepareImage, prepareVideo, preparationSignal } from '#helpers/media-dimensions.js'
import { useRoutePage } from '#shared/route-page.js'
import '#shared/icons/icon-file-download.js'
import '#shared/icons/icon-file-text-shield.js'
import '#shared/icons/icon-x.js'
import './file-name.js'
import { i18n } from '#i18n/index.js'
import { attachmentSizeStyle, fileCategory, fileName, fileSize } from '#helpers/attachment-presentation.js'

f('z-chat-attachment', ({ h, props }) => {
  const page = useRoutePage()
  const view = useStore({
    retry$: 0, retryable: true, loadedFor: null, imageRef$: null, videoRef$: null, captionRef$: null, ready$: false, loaded$: false, failed$: false, source$: null, dimensions$: null, poster$: false,
    // Caption starts clamped to two lines; each click reveals two more.
    captionLines$: 2,
    file$ () { return props.attachment$() || {} },
    placeholder$ () {
      try { return thumbHashToDataURL(base64ToBytes(this.file$().thumbhash)) } catch { return null }
    },
    identity$ () { return JSON.stringify([this.file$().url, props.source$?.()]) },
    size$ () { return this.dimensions$() || mediaDimensions(this.file$()) }
  })
  useSignerRecovery(() => { if (view.failed$() && view.retryable) view.retry$(n => n + 1) })
  const download = useMediaDownload(() => view.file$().url, () => !props.preview, () => fileName(view.file$(), t('unnamed-file')).full, view.file$)
  useTask(({ track, cleanup }) => {
    track(() => view.retry$())
    const identity = track(() => view.identity$())
    if (!track(() => page.isActive$())) return
    const [url, localSource] = JSON.parse(identity)
    const file = view.file$()
    const controller = new AbortController()
    cleanup(() => {
      controller.abort()
      const video = view.videoRef$()
      video?.pause()
      // A local source belongs to the composer/outbox. Acquired preview URLs
      // belong to this active view and must be reacquired after route activation.
      view.loadedFor = null
      view.source$(null)
    })
    view.loadedFor = identity
    const resolve = async () => {
      view.source$(null); view.ready$(false); view.failed$(false); view.loaded$(false); view.dimensions$(null); view.poster$(false)
      try {
        if (!/^(image|video)\//.test(file.mime)) return
        if (localSource || new URL(url).origin === 'https://nostr.alt') {
          // All prepared local previews are images, including video posters.
          const prepared = localSource ? { source: localSource, ...mediaDimensions(file) } : await acquireAttachmentPreview(file, { signal: controller.signal })
          if (!controller.signal.aborted && prepared) {
            view.dimensions$({ width: prepared.width, height: prepared.height })
            view.poster$(true)
            // The thumbnail stays still; only a confirmed image bubble plays
            // the original. Pending sends still own an unpublished preview.
            const animate = prepared.animated && !props.preview && file.download !== '1'
            view.source$(animate ? url : prepared.source)
            if (file.mime.startsWith('video/') && !props.preview) view.loaded$(true)
          }
        } else {
          const signal = preparationSignal(controller.signal)
          const prepared = file.mime.startsWith('image/') ? await prepareImage(url, { signal }) : await prepareVideo(url, { signal })
          if (!controller.signal.aborted) { view.dimensions$({ width: prepared.width, height: prepared.height }); view.source$(url) }
        }
      } catch (error) { if (!controller.signal.aborted) { view.retryable = canRecoverSignerFailure(error); view.failed$(true) } } finally { if (!controller.signal.aborted) view.ready$(true) }
    }
    resolve()
  }, { when: 'visible', rootMargin: '0px' })
  useTask(({ track, cleanup }) => {
    const { video, source, active, poster } = track(() => ({ video: view.videoRef$(), source: view.source$(), active: page.isActive$(), poster: view.poster$() }))
    if (!video || !source || !active) return
    // The DOM node can survive pending -> confirmed with an unchanged URL.
    // Own src here so cleanup cannot leave uhtml's attribute cache stale.
    video.src = poster ? view.file$().url : source
    cleanup(() => { video.pause(); video.removeAttribute('src'); video.load() })
  }, { after: 'rendering' })
  // The template engine retains detached nodes. Explicitly clear original
  // animated image sources as well as thumbnails when the route is inactive.
  useTask(({ track, cleanup }) => {
    const [image, source, active, failed] = track(() => [view.imageRef$(), view.source$(), page.isActive$(), view.failed$()])
    if (!image || !source || !active || failed) return
    const loaded = () => { if (image.complete && image.naturalWidth) view.loaded$(true) }
    const error = () => { if (image.complete && !image.naturalWidth) view.failed$(true) }
    image.addEventListener('load', loaded)
    image.addEventListener('error', error)
    image.src = source
    cleanup(() => {
      image.removeEventListener('load', loaded); image.removeEventListener('error', error)
      image.removeAttribute('src')
    })
  }, { after: 'rendering' })
  // The clamp is set on the node: it is a vendor-prefixed property that the
  // template's style attribute cache does not own.
  useTask(({ track }) => {
    const element = track(() => view.captionRef$())
    const lines = track(() => view.captionLines$())
    if (element) element.style.setProperty('-webkit-line-clamp', lines > 2 ? String(lines) : '2')
  }, { after: 'rendering' })
  const open = mediaOpenHandlers(props.openMedia, view.file$)
  const file = view.file$()
  const name = fileName(file, t('unnamed-file'))
  const size = fileSize(file.size, i18n.getLocale())
  const forceDownload = file.download === '1' && !props.preview
  const isMedia = /^(image|video)\//.test(file.mime)
  const visual = h`${view.placeholder$() && !view.loaded$() ? h`<img class="attachment-placeholder" src=${view.placeholder$()} alt="">` : null}${view.source$() && !view.failed$() && isMedia
    ? file.mime.startsWith('image/') || (view.poster$() && (props.preview || forceDownload))
      ? h`<img ref=${view.imageRef$} alt=${file.alt || name.full}>`
      : h`<video ref=${view.videoRef$} poster=${view.poster$() ? view.source$() : null} ?controls=${!forceDownload && !props.preview} ?muted=${forceDownload || props.preview} playsinline preload=${view.poster$() ? 'none' : 'metadata'} onplay=${event => { if (forceDownload || props.preview) event.target.pause() }} onloadeddata=${() => view.loaded$(true)} onerror=${() => view.failed$(true)}></video>`
    : null}`
  return h`<div class=${`chat-attachment ${props.preview ? 'attachment-preview' : ''}`} style=${props.preview ? null : attachmentSizeStyle(view.size$())} data-category=${fileCategory(file.mime)} data-chat-prepared=${String(view.ready$())}><style>${`
    z-chat-attachment .chat-attachment {
      display: block; min-width: 0; max-width: 100%; margin-block: 4px; white-space: normal; container-type: inline-size;
      .attachment-frame { display: block; position: relative; width: 100%; height: min(360px, calc(100cqi / var(--attachment-ratio))); overflow: hidden; border-radius: 8px; background: var(--z-control); }
      .attachment-frame img, .attachment-frame video { display: block; width: 100%; height: 100%; object-fit: contain; }
      .attachment-frame[role=button] { cursor: zoom-in; }
      .attachment-frame:focus-visible { outline: 2px solid var(--z-accent-text); outline-offset: -2px; }
      .media-expand { position: absolute; top: 6px; right: 6px; display: grid; place-items: center; width: 36px; height: 36px; padding: 9px; border: 0; border-radius: 50%; color: var(--z-viewer-text); background: transparent; cursor: pointer; }
      .media-expand:active { background: var(--z-viewer-overlay); }
      .media-expand:focus-visible { outline: 2px solid var(--z-viewer-text); outline-offset: 2px; }
      .download-media { cursor: pointer; }
      .download-media video { pointer-events: none; }
      .attachment-placeholder { position: absolute; inset: 0; pointer-events: none; }
      .attachment-download { display: flex; width: 100%; min-width: 0; gap: 8px; align-items: center; color: var(--z-accent-text); text-decoration: none; padding-block: 6px; }
      .attachment-download > icon-file-download { display: block !important; flex: none; }
      .attachment-name { flex: 1; min-width: 0; overflow: hidden; font-size: 14rem; }
      .attachment-size { display: block; color: var(--z-muted); font-size: 11rem; }
      .attachment-caption {
        display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden;
        width: 100%; margin: 0; padding: 0; border: 0; background: transparent;
        color: var(--z-muted); font: inherit; font-size: 13rem; font-style: italic; line-height: 1.35;
        text-align: start; overflow-wrap: anywhere; cursor: pointer;
      }
      a:focus-visible { outline: 2px solid var(--z-accent-text); outline-offset: -2px; }
      &.attachment-preview {
        position: relative; width: 100%; aspect-ratio: 1; margin: 0; overflow: hidden; border-radius: var(--attachment-tile-radius, 8px); color: var(--z-text);
        background: var(--z-file-other);
        &[data-category="media"] { background: var(--z-file-media); }
        &[data-category="audio"] { background: var(--z-file-audio); }
        &[data-category="document"] { background: var(--z-file-document); }
        &[data-category="archive"] { background: var(--z-file-archive); }
        .attachment-frame { position: absolute; inset: 0; height: 100%; background: transparent; }
        .attachment-fallback { position: absolute; inset: 0; display: grid; place-items: center; color: var(--z-muted); }
        .attachment-fallback f-svg { opacity: .85; }
        .attachment-size { position: absolute; top: 4px; left: 4px; max-width: calc(100% - 40px); padding: 2px 4px; border-radius: 4px; color: var(--z-text); background: var(--z-file-overlay); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 16px; }
        .attachment-remove { position: absolute; top: 0; right: 0; width: 32px; height: 32px; border: 0; padding: 5px; border-radius: 8px; background: transparent; color: var(--z-text); cursor: pointer; }
        .attachment-remove > span { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 5px; background: var(--z-file-overlay); }
        .attachment-remove:focus-visible { outline: 2px solid var(--z-accent-text); outline-offset: -2px; }
        .attachment-label { position: absolute; bottom: 0; left: 0; right: 0; display: flex; min-width: 0; padding: 4px; background: var(--z-file-overlay); font-size: 12rem; line-height: 18px; }
      }
    }
  `}</style>${props.preview
? h`<span class="attachment-frame">${!isMedia || view.failed$() || (!view.source$() && !view.placeholder$()) ? h`<span class="attachment-fallback" aria-hidden="true"><icon-file-text-shield props=${{ size: '32px', weight: 'light' }} /></span>` : null}${visual}</span>${size ? h`<span class="attachment-size">${size}</span>` : null}<span class="attachment-label"><z-file-name props=${{ file$: view.file$ }} /></span><button type="button" class="attachment-remove" aria-label=${t('Remove attachment')} onclick=${props.remove}><span><icon-x props=${{ size: '16px', weight: 'regular' }} /></span></button>`
: h`${view.size$() && isMedia
  ? forceDownload
    ? h`<a class="attachment-frame download-media" href=${download.href$()} target=${download.target} download=${download.attribute$()} aria-label=${t('Download file')} aria-disabled=${String(!download.href$())} onclick=${download.click}>${visual}</a>`
    : h`<span class="attachment-frame" role=${props.openMedia && file.mime.startsWith('image/') ? 'button' : null} tabindex=${props.openMedia && file.mime.startsWith('image/') ? '0' : null} aria-label=${props.openMedia ? t('View media') : null} onpointerdown=${open.down} onclick=${open.click} onkeydown=${open.key}>${visual}${props.openMedia && file.mime.startsWith('video/') ? h`<button class="media-expand" type="button" aria-label=${t('View media')} onclick=${open.expand}><icon-arrows-diagonal props=${{ size: '15px', weight: 'regular' }} /></button>` : null}</span>`
        : null}<a class="attachment-download" href=${download.href$() || null} target=${download.target} download=${download.attribute$()} aria-disabled=${String(!download.href$())} title=${t('Download file')} onclick=${download.click}><icon-file-download props=${{ size: '24px', weight: 'regular' }} /><span class="attachment-name"><z-file-name props=${{ file$: view.file$ }} />${size ? h`<span class="attachment-size">${size}</span>` : null}</span></a>${!props.preview && props.caption$?.() ? h`<button type="button" class="attachment-caption" aria-expanded=${String(view.captionLines$() > 2)} onpointerdown=${event => event.stopPropagation()} onclick=${event => { event.stopPropagation(); view.captionLines$(value => value + 2) }} ref=${view.captionRef$}>${props.caption$()}</button>` : null}`}
  </div>`
})

// The gallery shares the bounded thumbnail service with messages and replies.
f('z-chat-attachment-tile', ({ h, props }) => {
  const page = useRoutePage()
  const runtime = useMemo(() => ({ preview: null, key: null }))
  // The root is immutable for this keyed tile. Metadata stays reactive through
  // the shared catalog signal, without remounting intermediate item adapters.
  const view = useStore({ revision$: 0, file$ () { return props.files$()[props.root] || {} } })
  const file = view.file$()
  const key = `${file.root || file.url}:${file.mime}`
  const active = page.isActive$()
  // Render from a live lease, never from a restored signal holding a revoked
  // URL. Cache acquisition is synchronous, including remounts of keyed tiles.
  if (runtime.key !== key || !active) {
    runtime.preview?.close(); runtime.preview = null; runtime.key = key
  }
  if (active && (!runtime.preview || runtime.preview.closed)) runtime.preview = acquireCachedAttachmentPreview(file)
  view.revision$()
  useTask(({ cleanup }) => cleanup(() => { runtime.preview?.close(); runtime.preview = null }))
  useTask(({ track, cleanup }) => {
    const active = track(() => page.isActive$())
    track(() => `${view.file$().root || view.file$().url}:${view.file$().mime}`)
    const file = view.file$()
    const controller = new AbortController()
    cleanup(() => controller.abort())
    if (!active || (runtime.preview && !runtime.preview.closed)) return
    acquireAttachmentPreview(file, { signal: controller.signal }).then(preview => {
      if (controller.signal.aborted || runtime.key !== `${file.root || file.url}:${file.mime}` || !page.isActive$()) { preview?.close(); return }
      runtime.preview?.close()
      runtime.preview = preview
      view.revision$(value => value + 1)
    }).catch(() => {})
  }, { when: 'visible', rootMargin: '0px' })
  const source = runtime.preview?.closed ? null : runtime.preview?.source
  return h`<button type="button" title=${fileName(file, t('unnamed-file')).full} aria-label=${fileName(file, t('unnamed-file')).full} onclick=${() => props.select(file)}>${source ? h`<img src=${source} alt="">` : h`<icon-file-text-shield props=${{ size: '24px', weight: 'light' }} />`}</button>`
})
