import { useStore, useTask } from '#f'
import { isOnline, onOnline } from 'libp2r2p/network'
import { useAccount } from '#hooks/use-account.js'
import { useRoutePage } from '#shared/route-page.js'
import { parseChatContent } from '#helpers/chat-content.js'
import previews, { canPreviewNostrReference, safePreviewUrl } from '#services/link-preview.js'
import mediaCache from '#services/media-cache.js'

export function useReplyThumbnail (text$, { when = 'init', attachment$ } = {}) {
  const account = useAccount()
  const page = useRoutePage()
  const view = useStore({
    media$: null,
    failed$: false,
    loadedFor: null,
    candidates$ () {
      const attachment = attachment$?.()
      if (attachment) return [{ key: 'url', url: { value: attachment.url, m: attachment.mime, nfile: new URL(attachment.url).origin === 'https://nostr.alt', download: attachment.download } }]
      return parseChatContent(text$()).filter(item => item.key === 'url' || item.key === 'event')
    },
    identity$ () {
      const candidates = this.candidates$().filter(item => item.key !== 'event' || !account.messages$().some(message => message.id === item.event.id))
      return JSON.stringify([account.pubkey$(), candidates])
    },
    visible$ () { return this.media$() && !this.failed$() }
  })
  useTask(({ track, cleanup }) => {
    const active = track(() => page.isActive$())
    const identity = track(() => view.identity$())
    if (identity !== view.loadedFor) {
      view.media$(null)
      view.failed$(false)
      view.loadedFor = identity
    }
    const [owner, candidates] = JSON.parse(identity)
    if (!active || !candidates.length) return
    const controller = new AbortController()
    const { signal } = controller
    let pending = false
    const resolve = async () => {
      if (pending || signal.aborted || view.visible$()) return
      pending = true
      try {
        for (const item of candidates) {
          if (signal.aborted) return
          try {
            const reference = item.event
            let url = item.url?.value
            if (reference) {
              if (!await canPreviewNostrReference(reference, { owner, knownMessages: account.messages$(), eventStore: window.napp.eventStore, signer: window.nostr })) continue
              const pointer = reference.original.replace(/^nostr:/i, '')
              url = `https://njump.me/${pointer}`
            }
            if (signal.aborted || (!item.url?.nfile && !safePreviewUrl(url))) continue
            // A local binary document has no web page to enrich or HTTP image
            // to cache. Its filename remains the reply's representation.
            if (item.url?.nfile && !/^(image|video)\//.test(item.url.m ?? '')) continue
            const type = item.url?.m?.startsWith('video/') ? 'video' : 'image'
            let source
            if (/^(image|video)\//.test(item.url?.m ?? '')) {
              source = item.url?.nfile ? url : type === 'video' ? await isOnline({ signal }) ? url : null : (await mediaCache.resolveImage(url, { signal }))?.source
            } else {
              const metadata = await previews.load(url, { signal })
              if (signal.aborted || !metadata || (reference && !metadata.found)) continue
              source = (await mediaCache.resolveImage(metadata.image || metadata.icon, { signal }))?.source
            }
            if (signal.aborted) return
            if (source) {
              view.media$({ source, type, url, download: item.url?.download })
              view.failed$(false)
              return
            }
          } catch { /* Keep the text usable and try the next candidate. */ }
        }
      } finally { pending = false }
    }
    const stop = onOnline(resolve)
    resolve()
    cleanup(() => { controller.abort(); stop() })
  }, { when })
  return view
}
