import { t } from '#i18n/messages.js'
import { f } from '#f'
import '#shared/icons/icon-search.js'
import '#shared/icons/icon-circle-plus.js'
import './avatar.js'

f('z-home-header', ({ h, props }) => h`
  <header class="home-header">
    <style>${`
      z-home-header .home-header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; height: var(--home-header-height);
        padding-top: calc(22px + env(safe-area-inset-top) - 20.5px * var(--home-header-collapse));
        padding-bottom: calc(18px - 16.5px * var(--home-header-collapse));
        padding-inline: calc(18px - 6px * var(--home-header-collapse));
        pointer-events: auto; background: var(--z-surface);
        .brand {
          display: flex; align-items: center; min-width: 0; font-size: 25rem;
          gap: calc(11px - 3px * var(--home-header-collapse));
        }
        .brand-logo {
          --logo-size: calc(42px - 14px * var(--home-header-collapse));
          position: relative; width: var(--logo-size); height: var(--logo-size); flex: none;
          img {
            position: absolute; left: 50%; top: 50%; width: 125%; height: 125%;
            max-width: none; transform: translate(-50%, -50%); object-fit: contain;
          }
        }
        h1 { opacity: calc(1 - var(--home-header-collapse)); margin: 0; font-size: inherit; line-height: 1; font-weight: 650; letter-spacing: -.8px; }
        .actions { display: flex; align-items: center; gap: 2px; }
        button {
          display: grid; place-items: center; width: 40px; height: 44px;
          border: 0; padding: 0; border-radius: 12px; background: transparent;
          cursor: pointer;
        }
        button:active { background: var(--z-pressed); }
        .user-avatar { width: 26px; height: 26px; border-radius: 50%; overflow: hidden; }
      }
    `}</style>
    <div class="brand">
      <span class="brand-logo" aria-hidden="true"><img src="/zillion.icon.svg" alt="" width="256" height="256" draggable="false"></span>
      <h1>Zillion</h1>
    </div>
    <div class="actions">
      ${FUTURE_FEATURES_ENABLED
? h`
      <button type="button" aria-label=${t('Search messages')} aria-disabled="true">
        <span aria-hidden="true"><icon-search props=${{ size: '26px', weight: 'light' }} /></span>
      </button>
      <button type="button" aria-label=${t('New message')} aria-disabled="true">
        <span aria-hidden="true"><icon-circle-plus props=${{ size: '26px', weight: 'light' }} /></span>
      </button>
      `
: null}
      <button type="button" aria-label=${t('Your profile')} aria-disabled="true">
        <span class="user-avatar" aria-hidden="true"><z-home-avatar props=${{ person$: props.user$ }} /></span>
      </button>
    </div>
  </header>
`)
