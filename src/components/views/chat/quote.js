import './media-thumbnail.js'
import './file-reply.js'
import { f, useStore } from '#f'
import { shortQuotedText } from '#helpers/reference-label.js'
import { useReplyThumbnail } from './hooks/use-reply-thumbnail.js'

f('z-chat-quote', ({ h, props }) => {
  const view = useStore({ text$ () { return shortQuotedText(props.text$()) } })
  const thumbnail = useReplyThumbnail(props.mediaText$, { when: 'visible', attachment$: props.attachment$ })
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
    : null}<div class="quote-copy"><span class="quote-name" title=${props.author$()}>${props.author$()}</span><span class="quote-text" title=${props.text$()}>${props.attachment$?.() && !media ? h`<z-file-reply props=${{ file$: props.attachment$, caption$: props.text$ }} />` : view.text$()}</span></div></blockquote>`
})
