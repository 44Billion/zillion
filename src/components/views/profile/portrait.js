import { f, useLocation, useStore, useTask } from '#f'
import { t } from '#i18n/messages.js'
import mediaCache from '#services/media-cache.js'
import { useRoutePage } from '#shared/route-page.js'
import '#views/home/avatar.js'

f('z-profile-portrait', ({ h, props }) => {
  const page = useRoutePage()
  const location = useLocation()
  const view = useStore({ image$: null })
  useTask(async ({ track, cleanup }) => {
    const [url, active] = track(() => [props.banner$(), page.isActive$()])
    if (!active) return
    if (view.image$()?.url === url) return
    view.image$(null)
    if (!url) return
    const controller = new AbortController()
    cleanup(() => controller.abort())
    const image = await mediaCache.resolveImage(url, { signal: controller.signal })
    if (!controller.signal.aborted && image) view.image$({ url, source: image.source })
  })
  const source = view.image$()?.url === props.banner$() ? view.image$()?.source : null
  return h`
    <div class="profile-portrait" data-banner=${String(!!source)}>
      <style>${`
        z-profile-portrait .profile-portrait {
          .profile-cover { display: block; width: 100%; height: 160px; object-fit: cover; }
          .profile-photo { position: relative; width: 96px; height: 96px; margin: 24px auto 0;
            border-radius: 50%; background: var(--z-control); box-shadow: 0 0 0 5px var(--z-surface); overflow: hidden; font-size: 96rem; }
          button.profile-photo { display: block; padding: 0; border: 0; cursor: zoom-in; }
          button.profile-photo:focus-visible { outline: 2px solid var(--z-accent-text); outline-offset: 7px; }
          &[data-banner=true] .profile-photo { margin-top: -32px; }
        }
      `}</style>
      ${source ? h`<img class="profile-cover" src=${source} alt="" onerror=${() => view.image$(null)}>` : null}
      ${props.viewable ? h`<button class="profile-photo" type="button" aria-label=${t('View photo')} onclick=${() => location.pushState({ fromMediaOrigin: true }, '', `/profile/${encodeURIComponent(props.person$().id)}/photo`)}><z-home-avatar props=${{ person$: props.person$ }} /></button>` : h`<div class="profile-photo" aria-hidden="true"><z-home-avatar props=${{ person$: props.person$ }} /></div>`}
    </div>
  `
})
