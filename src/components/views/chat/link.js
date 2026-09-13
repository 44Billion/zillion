import { f, useStore, useTask } from '#f'
import { onOnline } from 'libp2r2p/network'
import { useAccount } from '#hooks/use-account.js'
import { useRoutePage } from '#shared/route-page.js'
import previews, { canPreviewNostrReference } from '#services/link-preview.js'
import mediaCache from '#services/media-cache.js'
import { abortable, preparationSignal, mediaSizeStyle } from '#helpers/media-dimensions.js'
import { shortNostrLabel, shortUrlLabel } from '#helpers/reference-label.js'

f('z-chat-link', ({ h, props }) => {
  const account = useAccount()
  const page = useRoutePage()
  const view = useStore({
    metadata$: null,
    prepared$: false,
    icon$: null,
    image$: null,
    loadedFor: null,
    target$ () {
      const item = props.item$()
      return item.key === 'event' ? item.event.original : item.url.value
    },
    knownPrivate$ () {
      const item = props.item$()
      return item.key === 'event' && account.messages$().some(message => message.id === item.event.id)
    },
    clear () { this.metadata$(null); this.icon$(null); this.image$(null) }
  })
  const item = props.item$()
  const reference = item.key === 'event' ? item.event : null
  const label = reference ? reference.original.replace(/^nostr:/i, '') : item.url.value
  const pointer = reference ? label.slice(0, reference.appSuffix ? -reference.appSuffix.length : undefined) : null
  const url = reference ? `https://njump.me/${pointer}` : item.url.value
  useTask(({ track, cleanup }) => {
    const active = track(() => page.isActive$())
    const target = track(() => view.target$())
    const known = track(() => view.knownPrivate$())
    const item = props.item$()
    const reference = item.key === 'event' ? item.event : null
    const pointer = reference?.original.replace(/^nostr:/i, '').slice(0, reference.appSuffix ? -reference.appSuffix.length : undefined)
    const url = reference ? `https://njump.me/${pointer}` : item.url.value
    const owner = track(() => account.pubkey$())
    const identity = JSON.stringify([owner, target])
    // Retained routes and unrelated messages must not clear existing previews.
    // A different target/account or newly discovered private copy must do so.
    if (view.loadedFor !== identity || known) { view.clear(); view.prepared$(known) }
    view.loadedFor = identity
    if (!active || known) return
    const controller = new AbortController()
    let pending = false
    const resolve = async () => {
      if (pending || controller.signal.aborted) return
      pending = true
      const signal = preparationSignal(controller.signal)
      try {
        if (reference && !await abortable(canPreviewNostrReference(reference, {
          knownMessages: account.messages$(), owner, eventStore: window.napp.eventStore, signer: window.nostr
        }), signal)) {
          if (!controller.signal.aborted) view.clear()
          return
        }
        if (controller.signal.aborted) return
        const metadata = await abortable(previews.load(url, { signal }), signal)
        if (controller.signal.aborted || !metadata || (reference && !metadata.found)) return
        view.metadata$(metadata)
        await Promise.all([
          (async () => {
            const source = await mediaCache.resolveImage(metadata.icon, { signal })
            if (!controller.signal.aborted && source) view.icon$(source.source)
          })(),
          (async () => {
            if (!metadata.image) return
            const source = await mediaCache.resolveImage(metadata.image, { signal })
            if (!controller.signal.aborted && source) view.image$(source)
          })()
        ])
      } finally { pending = false; if (!controller.signal.aborted) view.prepared$(true) }
    }
    const refresh = () => resolve().catch(() => {})
    const stop = onOnline(refresh)
    refresh()
    cleanup(() => { controller.abort(); stop() })
  }, { when: 'visible' })
  const metadata = view.metadata$()
  const href = reference && !metadata?.found ? `nostr:${label}` : url
  const iconError = () => {
    const fallback = new URL('/favicon.ico', url).href
    if (view.icon$() !== fallback && metadata?.icon !== fallback) view.icon$(fallback)
    else view.icon$(null)
  }
  return h`<span class="chat-link" data-chat-prepared=${String(view.prepared$())}><style>${`
    z-chat-link .chat-link {
      white-space: normal;
      .reference-link { display: inline-flex; align-items: baseline; vertical-align: bottom; max-width: 100%; gap: 5px; color: var(--z-accent-text); text-decoration: none; overflow-wrap: anywhere; }
      .reference-icon { display: block; width: 16px; height: 16px; object-fit: contain; flex: none; }
      .reference-label { min-width: 0; overflow-wrap: anywhere; }
      .website-preview { display: block; margin-block: 7px; padding: 10px; border-left: 3px solid var(--z-accent-text); border-radius: 5px 10px 10px 5px; background: var(--z-bubble-quote); color: var(--z-text); text-decoration: none; font-size: 14rem; }
      .preview-site { display: block; color: var(--z-accent-text); font-size: 12rem; margin-bottom: 4px; }
      .preview-description { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; margin-top: 4px; }
      .preview-image { display: block; height: auto; width: 320px; max-width: 100%; max-height: 200px; object-fit: contain; border-radius: 6px; margin-bottom: 7px; }
    }
  `}</style><a class="reference-link" href=${href} title=${label} aria-label=${label} target="_blank" rel="noopener noreferrer">${view.icon$() ? h`<img class="reference-icon" src=${view.icon$()} alt="" referrerpolicy="no-referrer" onerror=${iconError}>` : null}<span class="reference-label">${reference ? shortNostrLabel(label) : shortUrlLabel(label, item.url.ext)}</span></a>${metadata?.title || metadata?.description || metadata?.image ? h`<a class="website-preview" href=${href} target="_blank" rel="noopener noreferrer">${view.image$() ? h`<img class="preview-image" src=${view.image$().source} width=${view.image$().width} height=${view.image$().height} style=${mediaSizeStyle(view.image$(), 200)} alt="" referrerpolicy="no-referrer" onerror=${() => view.image$(null)}>` : null}<small class="preview-site">${metadata.site}</small>${metadata.title ? h`<strong>${metadata.title}</strong>` : null}${metadata.description ? h`<span class="preview-description">${metadata.description}</span>` : null}</a>` : null}</span>`
})
