import './media-thumbnail.js'
import './file-reply.js'
import { f, useStore, useTask, useMemo } from '#f'
import { attachmentCatalog, prepareAttachment } from '#services/chat-attachments.js'
import { useRoutePage } from '#shared/route-page.js'
import './attachment.js'
import '#f/components/f-to-signals.js'
import '#shared/icons/icon-photo-plus.js'
import { error } from '#shared/toast.js'
import { t } from '#i18n/messages.js'
import { shortQuotedText } from '#helpers/reference-label.js'
import { useReplyThumbnail } from './hooks/use-reply-thumbnail.js'
import '#shared/icons/icon-paperclip.js'
import '#shared/icons/icon-camera.js'
import '#shared/icons/icon-send-2.js'
import '#shared/icons/icon-x.js'

f('z-chat-composer', ({ h, props }) => {
  const page = useRoutePage()
  const runtime = useMemo(() => ({ attachment: null, controller: null }))
  const view = useStore({
    galleryId: `attachment-gallery-${crypto.randomUUID()}`,
    attachment$: null, source$: null, preparing$: false, gallery$: false, pickerRef$: null,
    catalog$ () { return attachmentCatalog(props.messages$?.() || []) },
    replyAttachment$ () { return props.reply$?.()?.attachment },
    canSend$ () { return props.canSend$?.() && !this.preparing$() && (!!this.attachment$() || !!this.text$().trim()) },
    remove () {
      runtime.controller?.abort(); runtime.controller = null
      runtime.attachment?.close?.(); runtime.attachment = null
      this.attachment$(null); this.source$(null); this.preparing$(false)
    },
    picker () { this.gallery$(false); this.pickerRef$()?.click() },
    attach () { if (this.catalog$().length) this.gallery$(!this.gallery$()); else this.picker() },
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
        const attachment = await prepareAttachment(file, { signal: controller.signal })
        if (controller.signal.aborted) { attachment.close(); return }
        runtime.attachment = attachment
        this.attachment$(attachment.metadata); this.source$(attachment.source)
      } catch (cause) {
        if (!controller.signal.aborted) error(() => t(cause.message === 'EMPTY_IRFS_FILE' ? 'Empty files cannot be sent' : 'Could not prepare file'))
      } finally { if (runtime.controller === controller) { runtime.controller = null; this.preparing$(false) } }
    },
    text$: '', fieldRef$: null, inputRef$: null,
    replyContent$ () {
      const reply = props.reply$?.()
      return reply ? reply.real ? reply.attachment ? reply.text || '' : reply.text : t(reply.text) : ''
    },
    replyText$ () { return shortQuotedText(this.replyContent$()) },
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
  useTask(({ cleanup }) => cleanup(() => view.remove()))
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
          .attachment-gallery button { border-radius: var(--attachment-tile-radius); width: 100%; height: auto; aspect-ratio: 1; background: var(--z-surface); color: var(--z-accent-text); overflow: hidden; cursor: pointer; }
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
      `}</style>
      ${props.reply$?.()
? h`<div class="composer-reply"><div class=${`reply-summary ${thumbnail.visible$() ? 'has-thumbnail' : ''}`}>${thumbnail.visible$()
? h`<z-media-thumbnail props=${{ media$: thumbnail.media$, className: 'reply-thumbnail', onError: () => thumbnail.failed$(true) }} />`
        : null}<span class=${`reply-text ${view.replyAttachment$() && !thumbnail.visible$() ? 'file-reply-text' : ''}`} title=${view.replyContent$()} aria-label=${t('Reply')}>${view.replyAttachment$() && !thumbnail.visible$() ? h`<z-file-reply props=${{ file$: view.replyAttachment$, caption$: view.replyContent$ }} />` : h`${t('Reply')}: ${view.replyText$()}`}</span></div><button class="cancel-reply" type="button" aria-label=${t('Cancel reply')} onclick=${props.clearReply}><icon-x props=${{ size: '24px', weight: 'regular' }} /></button></div>`
: null}
      <input type="file" hidden ref=${view.pickerRef$} onchange=${view.select}>
      ${view.preparing$() ? h`<div class="preparing-file"><button class="preparing-cancel" type="button" aria-label=${t('Remove attachment')} onclick=${view.remove}><icon-x props=${{ size: '16px' }} /></button><span role="status">${t('Preparing file…')}</span></div>` : null}
      ${view.attachment$() ? h`<div class="composer-attachment"><z-chat-attachment props=${{ attachment$: view.attachment$, source$: view.source$, preview: true, remove: view.remove }} /></div>` : null}
      ${view.gallery$() ? h`<div class="attachment-gallery" id=${view.galleryId}><button type="button" aria-label=${t('Attach file')} onclick=${view.picker}><icon-photo-plus props=${{ size: '36px', weight: 'duotone' }} /></button>${view.catalog$().map(file => h({ key: file.root })`<f-to-signals props=${{ from: { file }, render: ({ h, props: data }) => h`<z-chat-attachment-tile props=${{ file$: data.file$, select: view.reuse }} />` }} />`)}</div>` : null}
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
