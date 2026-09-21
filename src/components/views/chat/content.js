import { mediaOpenHandlers } from '#helpers/media-open.js'
import '#shared/icons/icon-arrows-diagonal.js'
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
import { messageAttachment } from '#services/chat-attachments.js'
import { isResolvableChatReference, CHAT_FILE_KIND, CHAT_TEXT_KIND } from '#services/chat-references.js'
import { augmentedContentItems, chatQuoteModel } from '#helpers/chat-timeline.js'

f('z-chat-content', ({ h, props }) => {
  const view = useStore({ items$ () { return parseChatContent(props.text$()) } })
  // `q`-only references have no URI position and render before the content.
  // Expanded blocks consume the line break that separated them, so a `\n`
  // between two URIs does not paint as a blank line.
  const items$ = () => augmentedContentItems([
    ...(props.prepend$?.() ?? []).map(reference => ({ key: 'event', prepend: true, event: { id: reference.id, kind: reference.kind } })),
    ...view.items$()
  ], props.references$?.() ?? {})
  return h`<span class="chat-content"><style>${`
      z-chat-content .chat-content {
        white-space: pre-wrap; overflow-wrap: anywhere;
        .chat-reference { color: var(--z-accent-text); text-decoration: none; }
      }
    `}</style>${items$().map((item, index) => h({ key: index })`<f-to-signals props=${{
      from: { item },
      render: ({ h, props: data }) => h`<z-chat-content-item props=${{ item$: data.item$, references$: props.references$, resolve$: props.resolve$, source$: props.source$, openMedia: props.openMedia }} />`
    }} />`)}</span>`
})

f('z-chat-content-item', ({ h, props }) => {
  const view = useStore({ attachment$ () { const url = props.item$().url; return { ...url?.nfile, ...url, url: url?.value, mime: url?.m || 'application/octet-stream' } } })
  const item = props.item$()
  const eventReference = item.key === 'event' ? item.event : null
  const resolved = eventReference ? props.references$?.()?.[eventReference.id] : null
  useTask(() => {
    if (!resolved && eventReference && isResolvableChatReference(eventReference)) props.resolve$?.(eventReference)
  })
  if (eventReference) {
    // Kind 9 renders as a quote and kind 1063 as its attachment card, in place
    // of the URI. Other kinds keep today's inline link/label behavior.
    if (resolved?.kind === CHAT_TEXT_KIND) {
      return h`<z-chat-quote props=${{ message$: () => chatQuoteModel(resolved, props.references$?.() ?? {}) }} />`
    }
    if (resolved?.kind === CHAT_FILE_KIND) {
      const file = messageAttachment(resolved)
      if (file) return h`<z-chat-attachment props=${{ attachment$: () => file, caption$: () => file.caption, source$: () => props.source$?.() ?? null, openMedia: props.openMedia }} />`
    }
    // A `q`-only reference that does not resolve to a chat message adds
    // nothing, exactly like the previous q-tag behavior.
    if (item.prepend) return null
  }
  if (item.key === 'url' && (item.url.nfile || (item.url.download === '1' && !/^(image|video)\//.test(item.url.m ?? '')))) return h`<z-chat-attachment props=${{ attachment$: view.attachment$, openMedia: props.openMedia }} />`
  if (item.key === 'text') return h`${item.text.value}`
  if (item.key === 'url' && /^(image|video)\//.test(item.url.m ?? '')) return h`<z-chat-media props=${{ item$: props.item$, openMedia: props.openMedia }} />`
  if (item.key === 'url' || item.key === 'event') return h`<z-chat-link props=${{ item$: props.item$ }} />`
  const reference = item[item.key]
  const label = reference.original ?? (item.key === 'hashtag' ? `#${reference.value}` : reference.value)
  if (item.key === 'app') return h`<a class="chat-reference" href=${appReferenceUrl(reference)} title=${label} aria-label=${label} target="_blank" rel="noopener noreferrer">${shortNostrLabel(label)}</a>`
  return h`<span class="chat-reference" title=${label}>${/^(?:nostr:)?(?:npub|nprofile|nrelay)1/i.test(label) ? shortNostrLabel(label) : label}</span>`
})

f('z-chat-media', ({ h, props }) => {
  const page = useRoutePage()
  const view = useStore({
    source$: null, videoRef$: null, imageRef$: null, retainedDimensions$: null,
    prepared$: false,
    loadedFor: null,
    failed$: false,
    url$ () { return props.item$().url.value },
    type$ () { return props.item$().url.m },
    dimensions$ () { return mediaDimensions(this.source$()) || this.retainedDimensions$() || (!this.prepared$() ? mediaDimensions(props.item$().url) : null) }
  })
  useTask(({ track, cleanup }) => {
    const active = track(() => page.isActive$())
    const url = track(() => view.url$())
    const type = track(() => view.type$())
    if (view.loadedFor !== url) {
      view.source$(null)
      view.failed$(false)
      view.prepared$(false)
      view.retainedDimensions$(null)
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
    cleanup(() => { controller.abort(); stop(); view.retainedDimensions$(mediaDimensions(view.source$()) || view.retainedDimensions$()); view.source$(null) })
  })
  useTask(({ track, cleanup }) => {
    const [video, source, active] = track(() => [view.videoRef$(), view.source$()?.source, page.isActive$()])
    if (!video || !source || !active) return
    video.src = source
    cleanup(() => { video.pause(); video.removeAttribute('src'); video.load() })
  }, { after: 'rendering' })
  useTask(({ track, cleanup }) => {
    const [image, source, active] = track(() => [view.imageRef$(), view.source$()?.source, page.isActive$()])
    if (!image || !source || !active) return
    image.src = source
    cleanup(() => image.removeAttribute('src'))
  }, { after: 'rendering' })
  const open = mediaOpenHandlers(props.openMedia, () => ({ url: view.url$() }))
  const download = useMediaDownload(view.url$, () => props.item$().url.download === '1')
  const media = props.item$().url
  const image = view.source$()
  const dimensions = view.failed$() ? null : view.dimensions$()
  const forceDownload = media.download === '1'
  const visual = image && !view.failed$()
    ? media.m?.startsWith('image/')
      ? h`<img ref=${view.imageRef$} width=${image.width} height=${image.height} alt=${media.alt ?? ''} loading="lazy" referrerpolicy="no-referrer" onerror=${() => view.failed$(true)}>`
      : h`<video ref=${view.videoRef$} width=${image.width} height=${image.height} ?controls=${!forceDownload} playsinline preload="metadata" onplay=${event => { if (forceDownload) event.target.pause() }} onerror=${() => view.failed$(true)}></video>`
    : null
  return h`<span class="chat-media" data-chat-prepared=${String(view.prepared$())}><style>${`
      z-chat-media .chat-media {
        a { color: var(--z-accent-text); text-decoration: none; overflow-wrap: anywhere; }
        .media-frame { position: relative; display: block; max-width: 100%; margin-block: 6px; }
        .media-frame[role=button] { cursor: zoom-in; }
        .media-frame:focus-visible { outline: 2px solid var(--z-accent-text); outline-offset: 2px; }
        .media-expand { position: absolute; top: 6px; right: 6px; display: grid; place-items: center; width: 36px; height: 36px; padding: 9px; border: 0; border-radius: 50%; color: var(--z-viewer-text); background: transparent; cursor: pointer; }
        .media-expand:active { background: var(--z-viewer-overlay); }
        .media-expand:focus-visible { outline: 2px solid var(--z-viewer-text); outline-offset: 2px; }
        .download-media video { pointer-events: none; }
        .media-frame[hidden] { display: none; }
        img, video { display: block; width: 100%; height: 100%; object-fit: contain; border-radius: 8px; }
      }
    `}</style><a href=${forceDownload ? download.href$() : media.value} title=${media.value} aria-label=${media.value} target=${forceDownload ? download.target : '_blank'} download=${forceDownload ? download.attribute$() : null} rel=${forceDownload ? null : 'noopener noreferrer'} onclick=${event => { if (forceDownload) download.click(event) }}>${shortUrlLabel(media.value, media.ext)}</a>${forceDownload
      ? h`<a class="media-frame download-media" style=${mediaSizeStyle(dimensions)} ?hidden=${!dimensions} href=${download.href$()} target=${download.target} download=${download.attribute$()} aria-label=${t('Download file')} aria-disabled=${String(!download.href$())} onclick=${download.click}>${visual}</a>`
      : h`<span class="media-frame" style=${mediaSizeStyle(dimensions)} ?hidden=${!dimensions} role=${props.openMedia && media.m?.startsWith('image/') ? 'button' : null} tabindex=${props.openMedia && media.m?.startsWith('image/') ? '0' : null} aria-label=${props.openMedia ? t('View media') : null} onpointerdown=${open.down} onclick=${open.click} onkeydown=${open.key}>${visual}${props.openMedia && media.m?.startsWith('video/') ? h`<button class="media-expand" type="button" aria-label=${t('View media')} onclick=${open.expand}><icon-arrows-diagonal props=${{ size: '15px', weight: 'regular' }} /></button>` : null}</span>`}</span>`
})
