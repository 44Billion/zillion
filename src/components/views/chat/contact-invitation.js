import { f } from '#f'
import { t } from '#i18n/messages.js'
import { info } from '#shared/toast.js'
import '#views/home/avatar.js'
import '#shared/icons/icon-user-plus.js'

f('z-contact-profile', ({ h, props }) => h`
  <div class="contact-profile">
    <style>${`
      z-contact-profile .contact-profile {
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        padding: clamp(28px, 12vh, 100px) 24px 32px; text-align: center;
        .profile-avatar { width: 88px; height: 88px; border-radius: 50%; overflow: hidden; margin-bottom: 10px; }
        h2 { margin: 0; font-size: 22rem; font-weight: 600; }
        p { margin: 0; max-width: 100%; overflow-wrap: anywhere; color: var(--z-muted); font-size: 14rem; }
      }
    `}</style>
    <span class="profile-avatar" aria-hidden="true"><z-home-avatar props=${{ person$: props.person$ }} /></span>
    <h2>${props.person$().name}</h2>
    <p>${props.person$().nip05}</p>
    <p>${t('Not in your contacts')}</p>
  </div>
`)

f('z-contact-invitation', ({ h, props }) => h`
  <div class="contact-invitation">
    <style>${`
      z-contact-invitation .contact-invitation {
        flex: none; margin: 8px 12px max(12px, env(safe-area-inset-bottom)); padding: 18px 16px 16px;
        border: 1px solid var(--z-border); border-radius: 18px; background: var(--z-chat-overlay);
        backdrop-filter: blur(12px); text-align: center;
        p { margin: 0 auto 16px; max-width: 360px; font-size: 14rem; line-height: 1.5; color: var(--z-muted); }
        button { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 48px;
          border: 0; border-radius: 12px; background: var(--z-primary); color: var(--z-on-primary); font-size: 16rem; cursor: pointer; }
        button:active { opacity: .8; }
      }
    `}</style>
    <p>${t('Add {{name}} to your contacts to send messages.', { name: props.person$().shortName })}</p>
    <button type="button" onclick=${() => info(() => t('Adding contacts is not available yet.'))}>
      <icon-user-plus props=${{ size: '24px', weight: 'regular' }} /><span>${t('Add contact')}</span>
    </button>
  </div>
`)
