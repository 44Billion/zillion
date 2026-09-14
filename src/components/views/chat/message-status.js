import { f } from '#f'
import { t } from '#i18n/messages.js'
import '#shared/icons/icon-clock.js'
import '#shared/icons/icon-alert-circle.js'
import { useStatusWidth } from './hooks/use-status-width.js'

f('z-chat-message-status', ({ h, props }) => {
  const width = useStatusWidth()
  const message = props.message$()
  const status = message.status ?? 'saved'
  return h`<span class="message-status" data-status=${status} ref=${width.outerRef$}>
    <style>${`
      z-chat-message-status .message-status {
        display: inline-block; min-width: 14px; min-height: max(14px, 1.25em); white-space: nowrap;
        .status-content { display: grid; width: max-content; min-width: 14px; min-height: max(14px, 1.25em); align-items: center; }
        &[data-status=pending] time, &[data-status=error] time { display: none; }
        .status-indicator { display: grid; place-items: center; width: 14px; height: 14px; }
        button { padding: 0; border: 0; background: transparent; color: var(--z-error); cursor: pointer; border-radius: 3px; }
        button:focus-visible { outline: 2px solid var(--z-accent-text); outline-offset: 2px; }
        button:active { background: var(--z-pressed); }
      }
    `}</style>
    <span class="status-content" ref=${width.innerRef$}><time datetime=${message.datetime} title=${message.date} aria-hidden=${String(status !== 'saved')}>${message.time}</time>
    ${status === 'pending'
      ? h`<span class="status-indicator" role="status" aria-label=${t('Saving message')} title=${t('Saving message')}><icon-clock props=${{ size: '14px', weight: 'regular' }} /></span>`
      : status === 'error'
        ? h`<button class="status-indicator" type="button" aria-label=${`${t('Could not save message')}. ${t('Retry')}`} title=${t('Could not save message')} aria-haspopup="menu" onpointerdown=${event => event.stopPropagation()} onclick=${props.onOpenError}><icon-alert-circle props=${{ size: '14px', weight: 'regular' }} /></button>`
        : null}</span>
  </span>`
})
