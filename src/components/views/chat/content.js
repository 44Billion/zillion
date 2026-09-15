import { t } from '#i18n/messages.js'
import { f, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import { parseChatContent } from '#helpers/chat-content.js'
import { appReferenceUrl } from '#helpers/app-reference.js'
import { shortNostrLabel, shortUrlLabel } from '#helpers/reference-label.js'
import { isOnline, onOnline } from 'libp2r2p/network'
import mediaCache from '#services/media-cache.js'
import './link.js'
import './attachment.js'
import { useMediaDownload } from './hooks/use-media-download.js'
import { useRoutePage } from '#shared/route-page.js'
import { abortable, preparationSignal, prepareVideo, mediaDimensions, mediaSizeStyle } from '#helpers/media-dimensions.js'

f('z-chat-content', ({ h, props }) => {
  const view = useStore({ items$ () { return parseChatContent(props.text$()) } })
  return h`<span class="chat-content"><style>${`
      z-chat-content .chat-content {
        white-space: pre-wrap; overflow-wrap: anywhere;
        .chat-reference { color: var(--z-accent-text); text-decoration: none; }
      }
    `}</style>${view.items$().map((item, index) => h({ key: index })`<f-to-signals props=${{
      from: { item },
      render: ({ h, props }) => h`<z-chat-content-item props=${{ item$: props.item$ }} />`
    }} />`)}</span>`
})

f('z-chat-content-item', ({ h, props }) => {
  const view = useStore({ attachment$ () { const url = props.item$().url; return { ...url?.nfile, ...url, url: url?.value, mime: url?.m || 'application/octet-stream' } } })
  const item = props.item$()
  if (item.key === 'url' && (item.url.nfile || (item.url.download === '1' && !/^(image|video)\//.test(item.url.m ?? '')))) return h`<z-chat-attachment props=${{ attachment$: view.attachment$ }} />`
  if (item.key === 'text') return h`${item.text.value}`
  if (item.key === 'url' && /^(image|video)\//.test(item.url.m ?? '')) return h`<z-chat-media props=${{ item$: props.item$ }} />`
  if (item.key === 'url' || item.key === 'event') return h`<z-chat-link props=${{ item$: props.item$ }} />`
  const reference = item[item.key]
  const label = reference.original ?? (item.key === 'hashtag' ? `#${reference.value}` : reference.value)
  if (item.key === 'app') return h`<a class="chat-reference" href=${appReferenceUrl(reference)} title=${label} aria-label=${label} target="_blank" rel="noopener noreferrer">${shortNostrLabel(label)}</a>`
  return h`<span class="chat-reference" title=${label}>${/^(?:nostr:)?(?:npub|nprofile|nrelay)1/i.test(label) ? shortNostrLabel(label) : label}</span>`
})

f('z-chat-media', ({ h, props }) => {
  const page = useRoutePage()
  const view = useStore({
    source$: null,
    prepared$: false,
    loadedFor: null,
    failed$: false,
    url$ () { return props.item$().url.value },
    type$ () { return props.item$().url.m },
    dimensions$ () { return mediaDimensions(this.source$()) || (!this.prepared$() ? mediaDimensions(props.item$().url) : null) }
  })
  useTask(({ track, cleanup }) => {
    const active = track(() => page.isActive$())
    const url = track(() => view.url$())
    const type = track(() => view.type$())
    if (view.loadedFor !== url) {
      view.source$(null)
      view.failed$(false)
      view.prepared$(false)
      view.loadedFor = url
    }
    if (!active) return
    if (!/^https:\/\//.test(url) || !/^(image|video)\//.test(type ?? '')) { view.prepared$(true); return }
    const controller = new AbortController()
    let pending = false
    const resolve = async () => {
      if (pending || controller.signal.aborted || (view.source$() && !view.failed$())) return
      pending = true
      const signal = preparationSignal(controller.signal)
      try {
        const source = type.startsWith('image/')
          ? await mediaCache.resolveImage(url, { signal })
          : await abortable(isOnline({ signal }), signal) ? await prepareVideo(url, { signal, dimensions: props.item$().url }) : null
        if (!controller.signal.aborted && source) { view.source$(source); view.failed$(false) }
      } catch { /* The URL remains usable when media cannot be loaded. */ } finally { pending = false; if (!controller.signal.aborted) view.prepared$(true) }
    }
    const stop = onOnline(resolve)
    resolve()
    cleanup(() => { controller.abort(); stop() })
  })
  const download = useMediaDownload(view.url$, () => props.item$().url.download === '1')
  const media = props.item$().url
  const image = view.source$()
  const dimensions = view.failed$() ? null : view.dimensions$()
  const forceDownload = media.download === '1'
  const visual = image && !view.failed$()
    ? media.m?.startsWith('image/')
      ? h`<img src=${image.source} width=${image.width} height=${image.height} alt=${media.alt ?? ''} loading="lazy" referrerpolicy="no-referrer" onerror=${() => view.failed$(true)}>`
      : h`<video src=${image.source} width=${image.width} height=${image.height} ?controls=${!forceDownload} playsinline preload="metadata" onplay=${event => { if (forceDownload) event.target.pause() }} onerror=${() => view.failed$(true)}></video>`
    : null
  return h`<span class="chat-media" data-chat-prepared=${String(view.prepared$())}><style>${`
      z-chat-media .chat-media {
        a { color: var(--z-accent-text); text-decoration: none; overflow-wrap: anywhere; }
        .media-frame { display: block; max-width: 100%; margin-block: 6px; }
        .download-media video { pointer-events: none; }
        .media-frame[hidden] { display: none; }
        img, video { display: block; width: 100%; height: 100%; object-fit: contain; border-radius: 8px; }
      }
    `}</style><a href=${forceDownload ? download.href$() : media.value} title=${media.value} aria-label=${media.value} target=${forceDownload ? download.target : '_blank'} download=${forceDownload ? download.attribute$() : null} rel=${forceDownload ? null : 'noopener noreferrer'} onclick=${event => { if (forceDownload) download.click(event) }}>${shortUrlLabel(media.value, media.ext)}</a>${forceDownload
      ? h`<a class="media-frame download-media" style=${mediaSizeStyle(dimensions)} ?hidden=${!dimensions} href=${download.href$()} target=${download.target} download=${download.attribute$()} aria-label=${t('Download file')} aria-disabled=${String(!download.href$())} onclick=${download.click}>${visual}</a>`
      : h`<span class="media-frame" style=${mediaSizeStyle(dimensions)} ?hidden=${!dimensions}>${visual}</span>`}</span>`
})
