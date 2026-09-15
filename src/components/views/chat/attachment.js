import { useMediaDownload } from './hooks/use-media-download.js'
import { f, useStore, useTask } from '#f'
import { thumbHashToDataURL } from 'thumbhash'
import { base64ToBytes } from 'libp2r2p/base64'
import { t } from '#i18n/messages.js'
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
    loadedFor: null, videoRef$: null, ready$: false, loaded$: false, failed$: false, source$: null, dimensions$: null,
    file$ () { return props.attachment$() || {} },
    placeholder$ () {
      try { return thumbHashToDataURL(base64ToBytes(this.file$().thumbhash)) } catch { return null }
    },
    identity$ () { return JSON.stringify([this.file$().url, props.source$?.()]) },
    size$ () { return this.dimensions$() || mediaDimensions(this.file$()) }
  })
  const download = useMediaDownload(() => view.file$().url, () => !props.preview, () => fileName(view.file$(), t('unnamed-file')).full, view.file$)
  useTask(({ track, cleanup }) => {
    const identity = track(() => view.identity$())
    if (!track(() => page.isActive$())) return
    const [url, localSource] = JSON.parse(identity)
    const file = view.file$()
    const controller = new AbortController()
    cleanup(() => { controller.abort(); view.videoRef$()?.pause() })
    if (view.loadedFor === identity && view.source$()) return
    view.loadedFor = identity
    const resolve = async () => {
      view.source$(null); view.ready$(false); view.failed$(false); view.loaded$(false); view.dimensions$(null)
      try {
        if (!/^(image|video)\//.test(file.mime)) return
        const source = localSource || url
        const signal = preparationSignal(controller.signal)
        const prepared = file.mime.startsWith('image/') ? await prepareImage(source, { signal }) : await prepareVideo(source, { signal })
        if (!controller.signal.aborted) { view.dimensions$(prepared); view.source$(source) }
      } catch { if (!controller.signal.aborted) view.failed$(true) } finally { if (!controller.signal.aborted) view.ready$(true) }
    }
    resolve()
  }, { when: 'visible', rootMargin: '0px' })
  const file = view.file$()
  const name = fileName(file, t('unnamed-file'))
  const size = fileSize(file.size, i18n.getLocale())
  const forceDownload = file.download === '1' && !props.preview
  const isMedia = /^(image|video)\//.test(file.mime)
  const visual = h`${view.placeholder$() && !view.loaded$() ? h`<img class="attachment-placeholder" src=${view.placeholder$()} alt="">` : null}${view.source$() && !view.failed$() && isMedia
    ? file.mime.startsWith('image/')
      ? h`<img src=${view.source$()} alt=${file.alt || name.full} onload=${() => view.loaded$(true)} onerror=${() => view.failed$(true)}>`
      : h`<video ref=${view.videoRef$} src=${view.source$()} ?controls=${!forceDownload && !props.preview} ?muted=${forceDownload || props.preview} playsinline preload="metadata" onplay=${event => { if (forceDownload || props.preview) event.target.pause() }} onloadeddata=${() => view.loaded$(true)} onerror=${() => view.failed$(true)}></video>`
    : null}`
  return h`<div class=${`chat-attachment ${props.preview ? 'attachment-preview' : ''}`} style=${props.preview ? null : attachmentSizeStyle(view.size$())} data-category=${fileCategory(file.mime)} data-chat-prepared=${String(view.ready$())}><style>${`
    z-chat-attachment .chat-attachment {
      display: block; min-width: 0; max-width: 100%; margin-block: 4px; white-space: normal; container-type: inline-size;
      .attachment-frame { display: block; position: relative; width: 100%; height: min(360px, calc(100cqi / var(--attachment-ratio))); overflow: hidden; border-radius: 8px; background: var(--z-control); }
      .attachment-frame img, .attachment-frame video { display: block; width: 100%; height: 100%; object-fit: contain; }
      .download-media { cursor: pointer; }
      .download-media video { pointer-events: none; }
      .attachment-placeholder { position: absolute; inset: 0; pointer-events: none; }
      .attachment-download { display: flex; width: 100%; min-width: 0; gap: 8px; align-items: center; color: var(--z-accent-text); text-decoration: none; padding-block: 6px; }
      .attachment-download > icon-file-download { display: block !important; flex: none; }
      .attachment-name { flex: 1; min-width: 0; overflow: hidden; font-size: 14rem; }
      .attachment-size { display: block; color: var(--z-muted); font-size: 11rem; }
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
    : h`<span class="attachment-frame">${visual}</span>`
  : null}<a class="attachment-download" href=${download.href$() || null} target=${download.target} download=${download.attribute$()} aria-disabled=${String(!download.href$())} title=${t('Download file')} onclick=${download.click}><icon-file-download props=${{ size: '24px', weight: 'regular' }} /><span class="attachment-name"><z-file-name props=${{ file$: view.file$ }} />${size ? h`<span class="attachment-size">${size}</span>` : null}</span></a>`}
  </div>`
})

// Native image lazy loading and visible-only video setup keep a large catalog
// from opening every file stream at once.
f('z-chat-attachment-tile', ({ h, props }) => {
  const page = useRoutePage()
  const view = useStore({ source$: null, videoRef$: null })
  useTask(({ track, cleanup }) => {
    const active = track(() => page.isActive$())
    const url = track(() => props.file$().url)
    if (active) view.source$(url)
    cleanup(() => view.videoRef$()?.pause())
  }, { when: 'visible', rootMargin: '0px' })
  const file = props.file$()
  return h`<button type="button" title=${fileName(file, t('unnamed-file')).full} aria-label=${fileName(file, t('unnamed-file')).full} onclick=${() => props.select(file)}>${file.mime.startsWith('image/') ? h`<img src=${view.source$()} alt="" loading="lazy">` : h`<video ref=${view.videoRef$} src=${view.source$()} muted playsinline preload="metadata"></video>`}</button>`
})
