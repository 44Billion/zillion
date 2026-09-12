import { f, useStore, useTask } from '#f'
import { useAnchoredMenu } from '#hooks/use-anchored-menu.js'
import { t } from '#i18n/messages.js'
import { useRoutePage } from '#shared/route-page.js'
import { shortUrlLabel } from '#helpers/reference-label.js'
import { canShareText, shareText } from '#helpers/share-text.js'
import { error } from '#shared/toast.js'
import { useMessagePress } from './hooks/use-message-press.js'
import '#shared/icons/icon-bubble.js'
import '#shared/icons/icon-share-2.js'
import '#shared/icons/icon-copy.js'
import '#shared/icons/icon-check.js'
import '#shared/icons/icon-trash.js'
import './content.js'
import './quote.js'

f('z-chat-message', ({ h, props }) => {
  const page = useRoutePage()
  const view = useStore(() => ({
    copied$: false,
    busy$: false,
    keyboard$: false,
    alive: true,
    content$ () { return props.message$().text },
    quoted$ () { return props.messages$().find(item => item.id === props.message$().replyTo) },
    quoteContent$ () {
      const quoted = this.quoted$()
      return quoted ? quoted.real ? quoted.text : t(quoted.text) : ''
    },
    quoteMedia$ () { return this.quoted$()?.real ? this.quoteContent$() : '' },
    quoteAuthor$ () { return this.quoted$()?.outgoing || props.person$().self ? t('You') : props.person$().name },
    selected$ () { return props.activeId$() === props.message$().id },
    placement$ () { return props.message$().outgoing ? 'left-end' : 'right-end' },
    text$ () {
      const message = props.message$()
      return [message.real ? message.text : t(message.text), message.url].filter(Boolean).join('\n')
    },
    open (keyboard) {
      if (!page.isActive$()) return
      this.keyboard$(keyboard)
      props.activeId$(props.message$().id)
    },
    key (event) {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]
      const index = items.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
      items[next]?.focus()
    },
    async share () {
      if (this.busy$()) return
      this.busy$(true)
      try {
        const result = await shareText(this.text$())
        if (!this.alive) return
        if (result === 'copied') this.copied$(true)
        else if (this.selected$()) props.activeId$(null)
      } catch (_) {
        if (this.alive) error(() => t('Could not copy message'))
      } finally {
        if (this.alive) this.busy$(false)
      }
    }
  }))
  const floating = useAnchoredMenu({ placement: view.placement$ })
  const press = useMessagePress(view.open)
  useTask(({ track }) => { if (!track(() => page.isActive$())) press.cancel() })
  useTask(({ track }) => floating.setIsOpen(track(() => view.selected$())))
  useTask(({ cleanup }) => cleanup(() => { view.alive = false }))
  useTask(({ track, cleanup }) => {
    if (!track(() => view.copied$())) return
    const timer = setTimeout(() => { view.copied$(false); if (view.selected$()) props.activeId$(null) }, 1600)
    cleanup(() => clearTimeout(timer))
  })
  useTask(({ track }) => {
    const element = track(() => view.selected$() && view.keyboard$() && floating.position$() && floating.floatingRef$())
    if (element) element.querySelector('button')?.focus({ preventScroll: true })
  }, { after: 'rendering' })
  const message = props.message$()
  const quoted = view.quoted$()
  const canShare = canShareText(view.text$())
  return h`
    ${message.dayLabel ? h`<li class="chat-date" data-day=${message.dayKey}>${message.dayLabel}</li>` : null}
    <li class=${`message-row ${message.outgoing ? 'outgoing' : 'incoming'}`} data-message-id=${message.id}>
      <style>${`
        z-chat-message .message-row {
          display: flex; margin: 5px 0; list-style: none;
          &.outgoing { justify-content: end; }
          .chat-bubble {
            position: relative; width: fit-content; max-width: calc(100% - 54px); min-width: 74px;
            padding: 9px 12px 6px; border-radius: 18px 18px 18px 5px;
            font-size: 16rem; line-height: 1.4;
            background: var(--z-bubble-incoming); color: var(--z-text);
            box-shadow: 0 1px 2px var(--z-shadow); outline-offset: 2px;
            -webkit-touch-callout: none; user-select: none; touch-action: pan-y pinch-zoom;
          }
          &.outgoing .chat-bubble { background: var(--z-bubble-outgoing); border-radius: 18px 18px 5px 18px; }
          .chat-bubble:focus-visible, .chat-bubble.selected { outline: 2px solid var(--z-accent-text); }
          .chat-bubble::after { content: ''; display: block; clear: both; }
          .message-text { display: inline; font-size: 16rem; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
          .message-meta { float: right; display: flex; align-items: center; justify-content: end; gap: 4px; margin: 6px 0 -1px 10px; color: var(--z-muted); font-size: 11rem; line-height: 1.25; }
          .message-link { display: block; text-decoration: none; color: var(--z-accent-text); font-size: 16rem; line-height: 1.4; overflow-wrap: anywhere; }
          .link-preview { display: block; margin-top: 7px; padding: 10px; border-left: 3px solid var(--z-accent-text); border-radius: 5px 10px 10px 5px; background: var(--z-bubble-quote); text-decoration: none; color: var(--z-text); font-size: 14rem; }
          .link-preview small { display: block; color: var(--z-accent-text); font-size: 12rem; margin-bottom: 4px; }
          .message-reaction { display: inline-flex; padding: 2px 8px; border-radius: 14px; background: var(--z-bubble-quote); margin-top: 6px; font-size: 16rem; }
        }
        z-chat-message .message-actions {
          z-index: 20; display: flex; flex-direction: column; gap: 4px; padding: 4px;
          border-radius: 26px; background: var(--z-chat-overlay); backdrop-filter: blur(12px);
          border: 1px solid var(--z-border); box-shadow: 0 3px 14px var(--z-shadow);
          button { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
          button:active { background: var(--z-pressed); }
          .message-delete { color: var(--z-error); }
          button.copied { background: var(--z-primary); color: var(--z-on-primary); }
          button[aria-disabled=true] { cursor: default; }
        }
      `}</style>
      <article class=${`chat-bubble ${view.selected$() ? 'selected' : ''}`} ref=${floating.anchorRef$} tabindex="0" aria-label=${t('Message from {{name}}', { name: message.outgoing || props.person$().self ? t('You') : props.person$().name })}
        aria-haspopup="menu" aria-expanded=${String(view.selected$())} onpointerdown=${press.down} onpointermove=${press.move}
        onpointerup=${press.cancel} onpointercancel=${press.cancel} onpointerleave=${press.cancel}
        oncontextmenu=${press.context} onkeydown=${press.key} onclick=${press.click}>
        ${quoted ? h`<z-chat-quote props=${{ text$: view.quoteContent$, author$: view.quoteAuthor$, mediaText$: view.quoteMedia$ }} />` : null}
        <div class="message-text">${message.real ? h`<z-chat-content props=${{ text$: view.content$ }} />` : t(message.text)}</div>
        ${message.url ? h`<a class="message-link" href=${message.url} title=${message.url} aria-label=${message.url} target="_blank" rel="noopener noreferrer">${shortUrlLabel(message.url)}</a><a class="link-preview" href=${message.url} target="_blank" rel="noopener noreferrer"><small>example.com</small><strong>${t(message.preview)}</strong></a>` : null}
        ${message.reaction ? h`<span class="message-reaction" aria-label=${t('Reaction')}>${message.reaction}</span>` : null}
        <div class="message-meta"><time datetime=${message.datetime ?? null} title=${message.date ?? null}>${message.time}</time>${message.outgoing && !message.real ? h`<span aria-label=${t('Read')}><icon-check props=${{ size: '13px', weight: 'regular' }} /></span>` : null}</div>
      </article>
      ${floating.isVisible$()
? h`
        <div class="message-actions" data-action-message=${message.id} role="menu" aria-label=${t('Message actions')} ref=${floating.floatingRef$} style=${floating.floatingStyle$()} onkeydown=${view.key}>
          <button type="button" role="menuitem" aria-label=${t('Reply')} aria-disabled=${String(!message.real)} onclick=${() => { if (message.real) props.onReply(message.id) }}><icon-bubble props=${{ size: '22px', weight: 'regular' }} /></button>
          <button class=${`message-share ${view.copied$() ? 'copied' : ''}`} type="button" role="menuitem" aria-label=${t(view.copied$() ? 'Copied' : canShare ? 'Share' : 'Copy')} ?disabled=${view.busy$()} onclick=${view.share}>
            ${view.copied$() ? h`<icon-check props=${{ size: '22px', weight: 'regular' }} />` : canShare ? h`<icon-share-2 props=${{ size: '22px', weight: 'regular' }} />` : h`<icon-copy props=${{ size: '22px', weight: 'regular' }} />`}
          </button>
          <button class="message-delete" type="button" role="menuitem" aria-label=${t('Delete message')} aria-disabled="true"><icon-trash props=${{ size: '22px', weight: 'regular' }} /></button>
        </div>
      `
: null}
    </li>
  `
})
