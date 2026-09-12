import { f, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import { parseChatContent } from '#helpers/chat-content.js'
import { shortNostrLabel, shortUrlLabel } from '#helpers/reference-label.js'
import { isOnline, onOnline } from 'libp2r2p/network'
import mediaCache from '#services/media-cache.js'
import './link.js'

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
  const item = props.item$()
  if (item.key === 'text') return h`${item.text.value}`
  if (item.key === 'url' && /^(image|video)\//.test(item.url.m ?? '')) return h`<z-chat-media props=${{ item$: props.item$ }} />`
  if (item.key === 'url' || item.key === 'event') return h`<z-chat-link props=${{ item$: props.item$ }} />`
  const reference = item[item.key]
  const label = reference.original ?? (item.key === 'hashtag' ? `#${reference.value}` : reference.value)
  return h`<span class="chat-reference" title=${label}>${/^(?:nostr:)?(?:npub|nprofile|nrelay)1/i.test(label) ? shortNostrLabel(label) : label}</span>`
})

f('z-chat-media', ({ h, props }) => {
  const view = useStore({
    source$: null,
    failed$: false,
    url$ () { return props.item$().url.value },
    type$ () { return props.item$().url.m }
  })
  useTask(({ track, cleanup }) => {
    const url = track(() => view.url$())
    const type = track(() => view.type$())
    view.source$(null)
    view.failed$(false)
    if (!/^https:\/\//.test(url) || !/^(image|video)\//.test(type ?? '')) return
    const controller = new AbortController()
    let pending = false
    const resolve = async () => {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const source = type.startsWith('image/')
          ? await mediaCache.resolveImage(url, { signal: controller.signal })
          : await isOnline({ signal: controller.signal }) ? url : null
        if (!controller.signal.aborted && source) { view.source$(source); view.failed$(false) }
      } catch { /* The URL remains usable when media cannot be loaded. */ } finally { pending = false }
    }
    const stop = onOnline(resolve)
    resolve()
    cleanup(() => { controller.abort(); stop() })
  })
  const media = props.item$().url
  return h`<span class="chat-media"><style>${`
      z-chat-media .chat-media {
        a { color: var(--z-accent-text); text-decoration: none; overflow-wrap: anywhere; }
        img, video { display: block; max-width: 100%; width: 320px; max-height: 360px; object-fit: contain; border-radius: 8px; margin-block: 6px; }
      }
    `}</style><a href=${media.value} title=${media.value} aria-label=${media.value} target="_blank" rel="noopener noreferrer">${shortUrlLabel(media.value, media.ext)}</a>${view.source$() && !view.failed$()
      ? media.m?.startsWith('image/')
        ? h`<img src=${view.source$()} alt=${media.alt ?? ''} loading="lazy" referrerpolicy="no-referrer" onerror=${() => view.failed$(true)}>`
        : h`<video src=${view.source$()} controls playsinline preload="metadata" onerror=${() => view.failed$(true)}></video>`
      : null}</span>`
})
