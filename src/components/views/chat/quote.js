import './media-thumbnail.js'
import './file-reply.js'
import { f, useStore } from '#f'
import { shortQuotedText } from '#helpers/reference-label.js'
import { useReplyThumbnail } from './hooks/use-reply-thumbnail.js'
import { t } from '#i18n/messages.js'

f('z-chat-quote', ({ h, props }) => {
  // The quoted message is a resolved kind 9: excerpt plus its first
  // thumbnailable item (or inline filename) and caption, as before.
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
      .quote-name { color: var(--z-accent-text); font-weight: 600; }
      .quote-thumbnail { display: block; flex: none; width: 38px; height: 38px; border-radius: 5px; object-fit: cover; background: var(--z-control); }
    }
  `}</style>${media
? h`<z-media-thumbnail props=${{ media$: thumbnail.media$, className: 'quote-thumbnail', onError: () => thumbnail.failed$(true) }} />`
    : null}<div class="quote-copy"><span class="quote-name" title=${props.author$?.() ?? t('You')}>${props.author$?.() ?? t('You')}</span><span class="quote-text" title=${view.text$()}>${view.attachment$() && !media ? h`<z-file-reply props=${{ file$: view.attachment$, caption$: view.raw$ }} />` : view.text$()}</span></div></blockquote>`
})
