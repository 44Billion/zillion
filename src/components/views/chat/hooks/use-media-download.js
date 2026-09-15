import { useStore, useTask } from '#f'
import { fileDownloadSource } from '#helpers/attachment-presentation.js'
import { t } from '#i18n/messages.js'
import { fileDownloadTarget } from '#helpers/file-download.js'
import { useRoutePage } from '#shared/route-page.js'

export function useMediaDownload (url$, enabled$ = () => true, filename$ = () => '', metadata$ = () => ({})) {
  const page = useRoutePage()
  const view = useStore({
    href$: null, local$: false,
    attribute$ () { return this.local$() ? null : filename$() || '' },
    target: fileDownloadTarget,
    click (event) {
      event.stopPropagation()
      if (!enabled$() || !page.isActive$() || !this.href$()) event.preventDefault()
    }
  })
  useTask(({ track, cleanup }) => {
    const [value, enabled, active, metadata, unnamed] = track(() => [url$(), enabled$(), page.isActive$(), metadata$(), t('unnamed-file')])
    view.href$(null)
    if (!value || !enabled || !active) return
    const controller = new AbortController()
    cleanup(() => controller.abort())
    let url
    try { url = new URL(value) } catch { return }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return
    // Fragment metadata is for presentation; it is not part of the file route.
    url.hash = ''
    view.local$(url.origin === 'https://nostr.alt')
    // Cross-origin HTTP servers must supply Content-Disposition: attachment.
    // Do not fetch the file into a Blob or navigate the conversation to it.
    if (!view.local$()) { view.href$(url.href); return }
    let source
    try { source = fileDownloadSource(url.href, metadata, unnamed) } catch { return }
    window.napp?.getFileDownloadUrl?.(source).then(href => {
      if (!controller.signal.aborted) view.href$(href)
    }).catch(() => {})
  })
  return view
}
