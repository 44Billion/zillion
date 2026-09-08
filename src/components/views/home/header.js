import { f } from '#f'
import '#shared/icons/icon-search.js'
import '#shared/icons/icon-circle-plus.js'
import './avatar.js'

f('z-home-header', ({ h, props }) => h`
  <header class="home-header">
    <style>${`
      z-home-header .home-header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; padding: 22px 18px 18px;
        .brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
        .logo-placeholder {
          display: grid; place-items: center; width: 42px; height: 42px;
          flex: none; border-radius: 13px; background: var(--z-logo);
          color: var(--z-accent-text); font-size: 27px; font-weight: 650;
        }
        h1 { margin: 0; font-size: 25px; font-weight: 650; letter-spacing: -.8px; }
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
      <span class="logo-placeholder" aria-hidden="true">Z</span>
      <h1>Zillion</h1>
    </div>
    <div class="actions">
      <button type="button" aria-label="Search messages" aria-disabled="true">
        <span aria-hidden="true"><icon-search props=${{ size: '26px', weight: 'light' }} /></span>
      </button>
      <button type="button" aria-label="New message" aria-disabled="true">
        <span aria-hidden="true"><icon-circle-plus props=${{ size: '26px', weight: 'light' }} /></span>
      </button>
      <button type="button" aria-label="Your profile" aria-disabled="true">
        <span class="user-avatar" aria-hidden="true"><z-home-avatar props=${{ person$: props.user$ }} /></span>
      </button>
    </div>
  </header>
`)
