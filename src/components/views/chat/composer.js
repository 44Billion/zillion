import './media-thumbnail.js'
import './file-reply.js'
import { f, useStore, useTask, useMemo } from '#f'
import { attachmentCatalog, prepareAttachment } from '#services/chat-attachments.js'
import { useRoutePage } from '#shared/route-page.js'
import './attachment.js'
import '#shared/icons/icon-photo-plus.js'
import '#shared/icons/icon-refresh-alert.js'
import { error, info } from '#shared/toast.js'
import { t } from '#i18n/messages.js'
import { shortQuotedText } from '#helpers/reference-label.js'
import { useReplyThumbnail } from './hooks/use-reply-thumbnail.js'
import '#shared/icons/icon-paperclip.js'
import '#shared/icons/icon-camera.js'
import '#shared/icons/icon-send-2.js'
import '#shared/icons/icon-x.js'

f('z-chat-composer', ({ h, props }) => {
  const page = useRoutePage()
  const runtime = useMemo(() => ({ attachment: null, controller: null, catalog: 0, catalogReading: false, catalogReload: false, catalogLoaded: false }))
  const view = useStore({
    galleryId: `attachment-gallery-${crypto.randomUUID()}`,
    attachment$: null, source$: null, preparing$: false, progress$: null, gallery$: false, galleryRef$: null, pickerRef$: null,
    catalogFiles$: [], catalogBusy$: false, catalogError$: false,
    // Only independent personal copies in the empty context belong here.
    catalog$ () {
      if (props.historyLoaded$?.() === false) return []
      return attachmentCatalog(this.catalogFiles$())
    },
    savedMessages$ () { return (props.messages$?.() ?? []).filter(message => message.status === 'saved').map(message => message.id).join(',') },
    catalogByRoot$ () { return Object.fromEntries(this.catalog$().map(file => [file.root, file])) },
    catalogState$ () {
      if (props.historyState$?.() === 'unavailable') return 'unavailable'
      return this.catalogBusy$() ? 'loading' : this.catalogError$() ? 'unavailable' : 'loaded'
    },
    loadingHold$: false, loadingAttempt$: 0,
    catalogLoading$ () { return this.loadingHold$() || this.catalogState$() === 'loading' },
    async loadCatalog (background = false) {
      if (runtime.catalogReading) { runtime.catalogReload = true; return }
      if (!props.readFiles) return
      runtime.catalogReading = true
      this.catalogBusy$(!background || !runtime.catalogLoaded)
      this.catalogError$(false)
      const generation = ++runtime.catalog
      try {
        // An unanswered read-permission request must not leave the gallery
        // spinning forever; fall back to the Retry tile instead.
        const timeout = Promise.withResolvers()
        const timer = setTimeout(() => timeout.reject(new Error('CATALOG_TIMEOUT')), 15000)
        timeout.promise.catch(() => {})
        const files = await Promise.race([props.readFiles(), timeout.promise]).finally(() => clearTimeout(timer))
        if (runtime.catalog === generation) { this.catalogFiles$(files); runtime.catalogLoaded = true }
      } catch {
        if (runtime.catalog === generation) this.catalogError$(true)
      } finally {
        if (runtime.catalog === generation) {
          runtime.catalogReading = false
          this.catalogBusy$(false)
          if (runtime.catalogReload) { runtime.catalogReload = false; this.loadCatalog(true) }
        }
      }
    },
    recover () {
      this.loadingHold$(true)
      this.loadingAttempt$(value => value + 1)
      this.loadCatalog()
      props.recover?.()
    },
    replyAttachment$ () { return props.reply$?.()?.attachment },
    canSend$ () { return props.canSend$?.() && !this.preparing$() && (!!this.attachment$() || !!this.text$().trim()) },
    remove () {
      runtime.controller?.abort(); runtime.controller = null
      runtime.attachment?.close?.(); runtime.attachment = null
      this.attachment$(null); this.source$(null); this.preparing$(false); this.progress$(null)
    },
    picker () { this.gallery$(false); this.pickerRef$()?.click() },
    attach () {
      if (this.gallery$()) { this.gallery$(false); return }
      if (this.catalog$().length) { this.gallery$(true); this.loadCatalog(true); return }
      if (this.catalogState$() === 'loaded') { this.picker(); return }
      this.gallery$(true)
      this.recover()
    },
    reuse (metadata) {
      this.remove(); this.gallery$(false)
      runtime.attachment = { metadata }
      this.attachment$(metadata)
    },
    async select (event) {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      this.remove(); this.preparing$(true)
      const controller = new AbortController()
      runtime.controller = controller
      try {
        const attachment = await prepareAttachment(file, { signal: controller.signal, onProgress: progress => { if (!controller.signal.aborted) this.progress$(progress) } })
        if (controller.signal.aborted) { attachment.close(); return }
        runtime.attachment = attachment
        if (attachment.compression.reason === 'unavailable') info(() => t('Compression unavailable; using original file'))
        this.attachment$(attachment.metadata); this.source$(attachment.source)
      } catch (cause) {
        if (!controller.signal.aborted) error(() => t(cause.message === 'EMPTY_IRFS_FILE' ? 'Empty files cannot be sent' : 'Could not prepare file'))
      } finally { if (runtime.controller === controller) { runtime.controller = null; this.preparing$(false) } }
    },
    text$: '', fieldRef$: null, inputRef$: null,
    replyContent$ () {
      const reply = props.reply$?.()
      // Raw compacted text keeps the URLs reply thumbnails parse; it is not the
      // text to show, because a kind-9 content for a file is only a URI.
      return reply ? reply.real ? (reply.caption || reply.text || '') : t(reply.text) : ''
    },
    // What the preview shows and what assistive technology reads: the caption
    // when the replied message has one, otherwise the text with expanded
    // references already removed.
    replySummary$ () {
      const reply = props.reply$?.()
      return reply ? reply.real ? (reply.caption || reply.displayText || '') : t(reply.text) : ''
    },
    replyText$ () { return shortQuotedText(this.replySummary$()) },
    send () {
      if (!this.canSend$()) return
      const text = this.text$()
      const replyId = props.reply$?.()?.id
      try {
        if (!props.send(text, runtime.attachment)) return
        runtime.attachment = null
        this.attachment$(null); this.source$(null)
        if (this.text$() === text) this.text$('')
        if (props.reply$?.()?.id === replyId) props.clearReply()
      } catch (_) { error(() => t('Could not save message')) }
    }
  })
  // Refresh after confirmed messages without replacing mounted gallery tiles
  // with loading placeholders. A write during an existing read queues a refresh.
  useTask(({ track }) => {
    const state = track(() => props.historyState$?.())
    track(() => view.savedMessages$())
    if (state !== 'loaded') return
    view.loadCatalog(true)
  }, { after: 'rendering' })
  // Hold only the gallery presentation, never the shared account recovery.
  // Start after rendering so even an immediate failure gets a visible interval.
  useTask(({ track, cleanup }) => {
    const { open, element } = track(() => ({ open: view.gallery$(), element: view.galleryRef$(), attempt: view.loadingAttempt$() }))
    if (!open) { view.loadingHold$(false); return }
    if (!element || !view.loadingHold$()) return
    let frame, timer
    const start = () => {
      if (!element.isConnected || !element.querySelector('.gallery-placeholder')) return
      observer.disconnect()
      frame = requestAnimationFrame(() => { timer = setTimeout(() => view.loadingHold$(false), 2000) })
    }
    // A retry can update signals before its placeholder DOM is committed.
    const observer = new MutationObserver(start)
    observer.observe(element, { childList: true, subtree: true })
    start()
    cleanup(() => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer) })
  }, { after: 'rendering' })
  const thumbnail = useReplyThumbnail(view.replyContent$, { attachment$: view.replyAttachment$ })
  useTask(({ track }) => { if (track(() => props.reply$?.())) view.inputRef$()?.focus() })
  useTask(({ track, cleanup }) => {
    const { input, field, text } = track(() => ({ input: view.inputRef$(), field: view.fieldRef$(), text: view.text$() }))
    if (!input || !field) return
    // Signal updates can precede template commits. Synchronize the value before
    // measuring, including programmatic clears after a successful send.
    if (input.value !== text) input.value = text
    const resize = () => {
      const style = getComputedStyle(input)
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const max = parseFloat(style.lineHeight) * 5 + padding
      input.style.height = '0px'
      input.style.height = `${Math.min(input.scrollHeight, max)}px`
      input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden'
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(field)
    cleanup(() => observer.disconnect())
  }, { after: 'rendering' })
  useTask(({ cleanup }) => cleanup(() => { runtime.catalog++; view.remove() }))
  useTask(({ track, cleanup }) => {
    if (!track(() => page.isActive$())) {
      view.gallery$(false)
      if (view.preparing$()) view.remove()
      return
    }
    const escape = event => { if (event.key === 'Escape') view.gallery$(false) }
    document.addEventListener('keydown', escape)
    cleanup(() => document.removeEventListener('keydown', escape))
  })
  const hasText = view.text$().length > 0
  const showMediaControls = FUTURE_FEATURES_ENABLED && !props.canAttach$?.() && !hasText
  return h`
    <footer class="chat-composer">
      <style>${`
        z-chat-composer .chat-composer {
          --attachment-tile-gap: 6px; --attachment-tile-radius: 8px;
          display: flex; flex-wrap: wrap; align-items: end; gap: 8px;
          padding: 8px max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
          background: var(--z-chat-canvas); flex: none;
          .composer-reply { flex: 0 0 100%; min-width: 0; display: flex; align-items: center; gap: 8px; color: var(--z-muted); font-size: 14rem; }
          .reply-summary { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
          .reply-summary.has-thumbnail { align-items: start; }
          .reply-text { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; white-space: normal; line-height: 22px; max-height: 44px; }
          .reply-thumbnail { display: block; flex: none; width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: var(--z-control); }
          .composer-attachment { flex: 0 0 100%; min-width: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--attachment-tile-gap); }
          .attachment-gallery { flex: 0 0 100%; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--attachment-tile-gap); max-height: 230px; overflow: auto; }
          .gallery-cell { min-width: 0; width: 100%; aspect-ratio: 1; border-radius: var(--attachment-tile-radius); overflow: hidden; background: var(--z-surface); }
          .attachment-gallery button { border-radius: var(--attachment-tile-radius); width: 100%; height: auto; aspect-ratio: 1; background: var(--z-surface); color: var(--z-accent-text); overflow: hidden; cursor: pointer; }
          .attachment-gallery .gallery-retry { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 13rem; }
          .gallery-placeholder { aspect-ratio: 1; border-radius: var(--attachment-tile-radius); background: var(--z-control); position: relative; overflow: hidden; }
          .gallery-placeholder::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--z-surface), transparent); animation: gallery-shimmer 1.4s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .gallery-placeholder::after { animation: none; background: none; } }
          .attachment-gallery img, .attachment-gallery video { width: 100%; height: 100%; object-fit: cover; }
          .preparing-file { flex: 0 0 100%; display: flex; align-items: center; gap: 8px; color: var(--z-muted); font-size: 14rem; line-height: 20px; }
          .preparing-file .preparing-cancel { width: 24px; height: 24px; border-radius: 5px; color: var(--z-muted); background: var(--z-control); cursor: pointer; }
          .compose-action:disabled { opacity: .5; }
          .composer-field { flex: 1; min-width: 0; display: flex; align-items: end; border-radius: 24px; background: var(--z-surface); border: 1px solid var(--z-border); }
          .composer-field:focus-within { outline: 2px solid var(--z-accent-text); outline-offset: -2px; }
          textarea {
            display: block; flex: 1; min-width: 0; width: 100%; height: 44px;
            margin: 0; border: 0; resize: none; padding: 10px 14px; border-radius: 24px;
            background: transparent; color: var(--z-text); font: inherit; font-size: 16rem; line-height: 1.5;
          }
          textarea::placeholder { color: var(--z-muted); opacity: 1; }
          textarea:focus { outline: none; }
          button { display: grid; place-items: center; flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; }
          .attach { color: var(--z-muted); background: transparent; }
          .attach[aria-expanded="true"] { color: var(--z-accent-text); }
          button:focus-visible { outline: 2px solid var(--z-accent-text); outline-offset: -2px; }
          .reply-text.file-reply-text { display: block; }
          .compose-action { background: var(--z-primary); color: var(--z-on-primary); }
          .cancel-reply { background: var(--z-surface); color: var(--z-muted); border: 1px solid var(--z-border); cursor: pointer; }
          .cancel-reply:active { background: var(--z-pressed); }
          button:active { filter: brightness(.94); }
        }
        @keyframes gallery-shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
      `}</style>
      ${props.reply$?.()
? h`<div class="composer-reply"><div class=${`reply-summary ${thumbnail.visible$() ? 'has-thumbnail' : ''}`}>${thumbnail.visible$()
? h`<z-media-thumbnail props=${{ media$: thumbnail.media$, className: 'reply-thumbnail', onError: () => thumbnail.failed$(true) }} />`
        : null}<span class=${`reply-text ${view.replyAttachment$() && !thumbnail.visible$() ? 'file-reply-text' : ''}`} title=${view.replyAttachment$() ? view.replySummary$() : view.replyContent$()} aria-label=${t('Reply')}>${view.replyAttachment$() && !thumbnail.visible$() ? h`<z-file-reply props=${{ file$: view.replyAttachment$, caption$: view.replySummary$ }} />` : h`${t('Reply')}: ${view.replyText$()}`}</span></div><button class="cancel-reply" type="button" aria-label=${t('Cancel reply')} onclick=${props.clearReply}><icon-x props=${{ size: '24px', weight: 'regular' }} /></button></div>`
: null}
      <input type="file" hidden ref=${view.pickerRef$} onchange=${view.select}>
      ${view.preparing$() ? h`<div class="preparing-file"><button class="preparing-cancel" type="button" aria-label=${t('Remove attachment')} onclick=${view.remove}><icon-x props=${{ size: '16px' }} /></button><span role="status">${view.progress$()?.phase === 'compress' ? t('Compressing file…') : t('Preparing file…')}${view.progress$()?.phase === 'compress' && Number.isFinite(view.progress$().progress) ? ` ${Math.floor(view.progress$().progress * 100)}%` : ''}</span></div>` : null}
      ${view.attachment$() ? h`<div class="composer-attachment"><z-chat-attachment props=${{ attachment$: view.attachment$, source$: view.source$, preview: true, remove: view.remove }} /></div>` : null}
      ${view.gallery$() ? h`<div class="attachment-gallery" ref=${view.galleryRef$} role="group" id=${view.galleryId} aria-label=${t('Attachments')} aria-busy=${String(view.catalogLoading$())}><button type="button" aria-label=${t('Attach file')} onclick=${view.picker}><icon-photo-plus props=${{ size: '36px', weight: 'duotone' }} /></button>${view.catalogLoading$() ? Array.from({ length: 3 }, () => h`<div class="gallery-placeholder" aria-hidden="true"></div>`) : []}${!view.catalogLoading$() && view.catalogState$() === 'unavailable' && !view.catalog$().length ? h`<button class="gallery-retry" type="button" onclick=${view.recover}><icon-refresh-alert props=${{ size: '28px', weight: 'regular' }} /><span>${t('Retry')}</span></button>` : null}${view.catalogLoading$() ? [] : view.catalog$().map(file => h({ key: file.root })`<div class="gallery-cell"><z-chat-attachment-tile props=${{ root: file.root, files$: view.catalogByRoot$, select: view.reuse }} /></div>`)}</div>` : null}
      <div class="composer-field" ref=${view.fieldRef$}>
        <textarea ref=${view.inputRef$} rows="1" placeholder=${t(view.attachment$() ? 'Caption' : 'Message')} aria-label=${t('Message')}
          enterkeyhint="enter" oninput=${event => view.text$(event.target.value)}></textarea>
        ${props.canAttach$?.() || showMediaControls ? h`<button class="attach" type="button" aria-expanded=${String(view.gallery$())} aria-controls=${view.gallery$() ? view.galleryId : null} aria-label=${t('Attach file')} aria-disabled=${String(!props.canAttach$?.())} onclick=${() => { if (props.canAttach$?.()) view.attach() }}><icon-paperclip props=${{ size: '24px', weight: 'light' }} /></button>` : null}
      </div>
      <button class="compose-action" type="button" aria-label=${t(showMediaControls ? 'Camera' : 'Send message')} aria-disabled=${String(!view.canSend$())} ?disabled=${view.preparing$()} onclick=${view.send}>
        ${showMediaControls ? h`<icon-camera props=${{ size: '24px', weight: 'regular' }} />` : h`<icon-send-2 props=${{ size: '24px', weight: 'regular' }} />`}
      </button>
    </footer>
  `
})
