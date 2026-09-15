import { f } from '#f'
import { t } from '#i18n/messages.js'
import { useMediaDownload } from './hooks/use-media-download.js'

f('z-media-thumbnail', ({ h, props }) => {
  const download = useMediaDownload(() => props.media$()?.url, () => props.media$()?.download === '1')
  const media = props.media$()
  if (!media) return
  const thumbnail = media.type === 'video'
    ? h`<video class=${props.className} src=${media.source} muted playsinline preload="metadata" aria-hidden="true" tabindex="-1" onplay=${event => { if (media.download === '1') event.target.pause() }} onerror=${props.onError}></video>`
    : h`<img class=${props.className} src=${media.source} alt="" referrerpolicy="no-referrer" onerror=${props.onError}>`
  return h`${media.download === '1'
    ? h`<a class="thumbnail-download" href=${download.href$()} target=${download.target} download=${download.attribute$()} aria-label=${t('Download file')} aria-disabled=${String(!download.href$())} onclick=${download.click}><style>${'.thumbnail-download { display: block; flex: none; } .thumbnail-download > video { pointer-events: none; }'}</style>${thumbnail}</a>`
    : thumbnail}`
})
