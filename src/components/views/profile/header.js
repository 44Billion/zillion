import { f, useLocation } from '#f'
import { t } from '#i18n/messages.js'
import '#shared/icons/icon-chevron-down.js'

f('z-profile-header', ({ h, props }) => {
  const location = useLocation()
  const back = () => {
    const state = props.route$().state
    if (state?.fromHome || state?.fromChat || state?.fromProfile) location.back()
    else location.replaceState({}, '', props.editing ? '/profile/user' : '/')
  }
  return h`
    <header class="profile-header">
      <style>${`
        z-profile-header .profile-header {
          position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 10px;
          min-height: calc(68px + env(safe-area-inset-top)); padding: env(safe-area-inset-top) 18px 0;
          background: var(--z-surface);
          h1 { flex: 1; min-width: 0; margin: 0; font-size: 22rem; font-weight: 650; line-height: 1.2; letter-spacing: -.4px; }
          button { min-width: 44px; min-height: 44px; padding: 8px; border: 0; border-radius: 50%; background: transparent; }
          .profile-back { display: grid; place-items: center; }
          .profile-back:active { background: var(--z-pressed); }
          .profile-save { color: var(--z-muted); font-size: 14rem; border-radius: 12px; opacity: .65; }
        }
      `}</style>
      <button class="profile-back" type="button" onclick=${back} aria-label=${t('Back')}><icon-chevron-down props=${{ rotate: 90, size: '24px', weight: 'regular' }} /></button>
      <h1>${props.title$()}</h1>
      ${props.editing ? h`<button class="profile-save" type="button" disabled title=${t('Profile editing is not available yet.')}>${t('Save')}</button>` : null}
    </header>
  `
})
