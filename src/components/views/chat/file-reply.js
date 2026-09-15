import { f } from '#f'
import './file-name.js'
import { fileName } from '#helpers/attachment-presentation.js'
import { shortQuotedText } from '#helpers/reference-label.js'
import { t } from '#i18n/messages.js'

f('z-file-reply', ({ h, props }) => {
  const caption = shortQuotedText(props.caption$() || '')
  const name = fileName(props.file$(), t('unnamed-file'))
  return h`<span class="file-reply" data-caption=${String(!!caption)} title=${name.full + (caption ? ` ${caption}` : '')}><style>${`
    z-file-reply .file-reply {
      display: block; min-width: 0; max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere;
      &[data-caption="true"] .file-name { max-width: 50%; }
      .file-caption { display: inline; }
    }
  `}</style><z-file-name props=${{ file$: props.file$ }} />${caption ? h`<span class="file-caption">${' ' + caption}</span>` : null}</span>`
})
