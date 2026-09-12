import { f, useStore, useTask } from '#f'
import { error } from '#shared/toast.js'
import { t } from '#i18n/messages.js'
import { shortQuotedText } from '#helpers/reference-label.js'
import { useReplyThumbnail } from './hooks/use-reply-thumbnail.js'
import '#shared/icons/icon-paperclip.js'
import '#shared/icons/icon-camera.js'
import '#shared/icons/icon-send-2.js'
import '#shared/icons/icon-x.js'

f('z-chat-composer', ({ h, props }) => {
  const view = useStore({
    text$: '', fieldRef$: null, inputRef$: null, busy$: false, alive: true,
    replyContent$ () {
      const reply = props.reply$?.()
      return reply ? reply.real ? reply.text : t(reply.text) : ''
    },
    replyText$ () { return shortQuotedText(this.replyContent$()) },
    async send () {
      if (!props.canSend$?.() || this.busy$() || !this.text$().trim()) return
      const text = this.text$()
      const replyId = props.reply$?.()?.id
      this.busy$(true)
      try {
        await props.send(text)
        if (this.alive) {
          if (this.text$() === text) this.text$('')
          if (props.reply$?.()?.id === replyId) props.clearReply()
        }
      } catch (_) { if (this.alive) error(() => t('Could not save message')) } finally { if (this.alive) this.busy$(false) }
    }
  })
  const thumbnail = useReplyThumbnail(view.replyContent$)
  useTask(({ cleanup }) => cleanup(() => { view.alive = false }))
  useTask(({ track }) => { if (track(() => props.reply$?.())) view.inputRef$()?.focus() })
  useTask(({ track, cleanup }) => {
    const { input, field } = track(() => ({ input: view.inputRef$(), field: view.fieldRef$(), text: view.text$() }))
    if (!input || !field) return
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
  const hasText = view.text$().length > 0
  const showMediaControls = FUTURE_FEATURES_ENABLED && !hasText
  return h`
    <footer class="chat-composer">
      <style>${`
        z-chat-composer .chat-composer {
          display: flex; flex-wrap: wrap; align-items: end; gap: 8px;
          padding: 8px max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
          background: var(--z-chat-canvas); flex: none;
          .composer-reply { flex: 0 0 100%; min-width: 0; display: flex; align-items: center; gap: 8px; color: var(--z-muted); font-size: 14rem; }
          .reply-summary { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
          .reply-summary.has-thumbnail { align-items: start; }
          .reply-text { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; white-space: normal; line-height: 22px; max-height: 44px; }
          .reply-thumbnail { display: block; flex: none; width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: var(--z-control); }
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
          .compose-action { background: var(--z-primary); color: var(--z-on-primary); }
          .cancel-reply { background: var(--z-surface); color: var(--z-muted); border: 1px solid var(--z-border); cursor: pointer; }
          .cancel-reply:active { background: var(--z-pressed); }
          button:active { filter: brightness(.94); }
        }
      `}</style>
      ${props.reply$?.()
? h`<div class="composer-reply"><div class=${`reply-summary ${thumbnail.visible$() ? 'has-thumbnail' : ''}`}>${thumbnail.visible$()
? thumbnail.media$().type === 'video'
        ? h`<video class="reply-thumbnail" src=${thumbnail.media$().source} muted playsinline preload="metadata" aria-hidden="true" tabindex="-1" onerror=${() => thumbnail.failed$(true)}></video>`
        : h`<img class="reply-thumbnail" src=${thumbnail.media$().source} alt="" referrerpolicy="no-referrer" onerror=${() => thumbnail.failed$(true)}>`
        : null}<span class="reply-text" title=${view.replyContent$()}>${t('Reply')}: ${view.replyText$()}</span></div><button class="cancel-reply" type="button" aria-label=${t('Cancel reply')} onclick=${props.clearReply}><icon-x props=${{ size: '24px', weight: 'regular' }} /></button></div>`
: null}
      <div class="composer-field" ref=${view.fieldRef$}>
        <textarea ref=${view.inputRef$} rows="1" placeholder=${t('Message')} aria-label=${t('Message')}
          enterkeyhint="enter" .value=${view.text$()} oninput=${event => view.text$(event.target.value)}></textarea>
        ${showMediaControls ? h`<button class="attach" type="button" aria-label=${t('Attach file')} aria-disabled="true"><icon-paperclip props=${{ size: '24px', weight: 'light' }} /></button>` : null}
      </div>
      <button class="compose-action" type="button" aria-label=${t(showMediaControls ? 'Camera' : 'Send message')} aria-disabled=${String(showMediaControls || !props.canSend$?.() || view.busy$() || !view.text$().trim())} onclick=${view.send}>
        ${showMediaControls ? h`<icon-camera props=${{ size: '24px', weight: 'regular' }} />` : h`<icon-send-2 props=${{ size: '24px', weight: 'regular' }} />`}
      </button>
    </footer>
  `
})
