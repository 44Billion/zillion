import { useAccount } from '#hooks/use-account.js'
import { showDialog } from '#shared/dialog.js'
import '#shared/icons/icon-alert-circle.js'
import './media-thumbnail.js'
import './file-reply.js'
import { f, useStore } from '#f'
import { shortQuotedText } from '#helpers/reference-label.js'
import { useReplyThumbnail } from './hooks/use-reply-thumbnail.js'
import { t } from '#i18n/messages.js'

f('z-chat-quote', ({ h, props }) => {
  // The quoted message is a resolved kind 9: excerpt plus its first
  // thumbnailable item (or inline filename) and caption, as before.
  const account = useAccount()
  const author$ = () => props.author$?.() ?? (model$()?.pubkey && model$().pubkey !== account.pubkey$() ? account.personFor(model$().pubkey)?.name : t('You'))
  const model$ = () => props.message$?.() ?? null
  const view = useStore({
    raw$ () { const model = model$(); return model?.caption || model?.text || '' },
    text$ () { return shortQuotedText(this.raw$()) },
    attachment$ () { return model$()?.attachment ?? null },
    content$ () { return model$()?.content ?? '' }
  })
  const thumbnail = useReplyThumbnail(view.content$, { when: 'visible', attachment$: view.attachment$ })
  const media = thumbnail.visible$() ? thumbnail.media$() : null
  return h`<blockquote class="message-quote"><style>${`
    z-chat-quote .message-quote {
      display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%;
      margin: 0 0 7px; padding: 7px 9px; border-left: 3px solid var(--z-accent-text);
      border-radius: 5px 12px 12px 5px; background: var(--z-bubble-quote); font-size: 14rem; line-height: 1.35;
      .quote-copy { flex: 1; min-width: 0; }
      .quote-name, .quote-text { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .unverified { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: var(--z-muted); font-size: 11rem; padding: 2px 0; cursor: pointer; }
      .quote-name { color: var(--z-accent-text); font-weight: 600; }
      .quote-thumbnail { display: block; flex: none; width: 38px; height: 38px; border-radius: 5px; object-fit: cover; background: var(--z-control); }
    }
  `}</style>${media
? h`<z-media-thumbnail props=${{ media$: thumbnail.media$, className: 'quote-thumbnail', onError: () => thumbnail.failed$(true) }} />`
    : null}<div class="quote-copy"><span class="quote-name" title=${author$()}>${author$()}</span><span class="quote-text" title=${view.text$()}>${view.attachment$() && !media ? h`<z-file-reply props=${{ file$: view.attachment$, caption$: view.raw$ }} />` : view.text$()}</span>${model$()?.hearsay ? h`<button class="unverified" type="button" onpointerdown=${event => event.stopPropagation()} onclick=${event => { event.stopPropagation(); showDialog({ title: () => t('Unverified'), description: () => t('This message was received secondhand, without cryptographic proof of its original author.') }) }}><icon-alert-circle props=${{ size: '14px' }} />${t('Unverified')}</button>` : null}</div></blockquote>`
})
