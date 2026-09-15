import { useMediaDownload } from './hooks/use-media-download.js'
import { f, useStore, useTask } from '#f'
import { thumbHashToDataURL } from 'thumbhash'
import { base64ToBytes } from 'libp2r2p/base64'
import { t } from '#i18n/messages.js'
import { mediaSizeStyle, mediaDimensions, prepareImage, prepareVideo, preparationSignal } from '#helpers/media-dimensions.js'
import { useRoutePage } from '#shared/route-page.js'
import '#shared/icons/icon-file-download.js'

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
  const download = useMediaDownload(() => view.file$().url, () => !props.preview, () => view.file$().filename)
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
  const forceDownload = file.download === '1' && !props.preview
  const visual = h`${view.placeholder$() && !view.loaded$() ? h`<img class="attachment-placeholder" src=${view.placeholder$()} alt="">` : null}${view.source$() && !view.failed$() && /^(image|video)\//.test(file.mime)
    ? file.mime.startsWith('image/')
      ? h`<img src=${view.source$()} alt=${file.alt || file.filename || ''} onload=${() => view.loaded$(true)} onerror=${() => view.failed$(true)}>`
      : h`<video ref=${view.videoRef$} src=${view.source$()} ?controls=${!forceDownload} ?muted=${forceDownload} playsinline preload="metadata" onplay=${event => { if (forceDownload) event.target.pause() }} onloadeddata=${() => view.loaded$(true)} onerror=${() => view.failed$(true)}></video>`
    : null}`
  return h`<div class="chat-attachment" data-chat-prepared=${String(view.ready$())}><style>${`
    z-chat-attachment .chat-attachment {
      display: block; max-width: 100%; margin-block: 4px; white-space: normal;
      .attachment-frame { display: block; position: relative; max-width: 100%; overflow: hidden; border-radius: 8px; background: var(--z-control); }
      .attachment-frame img, .attachment-frame video { display: block; width: 100%; height: 100%; object-fit: contain; }
      .download-media { cursor: pointer; }
      .download-media video { pointer-events: none; }
      .attachment-placeholder { position: absolute; inset: 0; pointer-events: none; }
      .attachment-download { display: flex; gap: 8px; align-items: center; color: var(--z-accent-text); text-decoration: none; padding-block: 6px; }
      .attachment-name { min-width: 0; overflow-wrap: anywhere; font-size: 14rem; }
      .attachment-size { display: block; color: var(--z-muted); font-size: 11rem; }
    }
  `}</style>${view.size$() && /^(image|video)\//.test(file.mime)
? forceDownload
  ? h`<a class="attachment-frame download-media" style=${mediaSizeStyle(view.size$(), 360)} href=${download.href$()} target=${download.target} download=${download.attribute$()} aria-label=${t('Download file')} aria-disabled=${String(!download.href$())} onclick=${download.click}>${visual}</a>`
  : h`<span class="attachment-frame" style=${mediaSizeStyle(view.size$(), props.preview ? 180 : 360)}>${visual}</span>`
: null}
    <a class="attachment-download" href=${download.href$() || null} target=${download.target} download=${download.attribute$()} aria-disabled=${String(!download.href$())} title=${props.preview ? file.filename : t('Download file')} onclick=${download.click}><icon-file-download props=${{ size: '24px', weight: 'regular' }} /><span class="attachment-name">${file.filename || t('File')}<span class="attachment-size">${file.size === undefined ? '' : `${file.size.toLocaleString()} B`}</span></span></a>
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
  return h`<button type="button" title=${file.filename || t('File')} aria-label=${file.filename || t('File')} onclick=${() => props.select(file)}>${file.mime.startsWith('image/') ? h`<img src=${view.source$()} alt="" loading="lazy">` : h`<video ref=${view.videoRef$} src=${view.source$()} muted playsinline preload="metadata"></video>`}</button>`
})
