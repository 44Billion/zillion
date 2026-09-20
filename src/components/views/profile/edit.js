import { f, useStore } from '#f'
import { t } from '#i18n/messages.js'
import { profileDetails } from '#helpers/profile-presentation.js'
import { parseProfileLightning } from '#helpers/profile-payments.js'
import { getRandomId } from '#helpers/random-id.js'
import { useAccount } from '#hooks/use-account.js'
import { profileStyles } from './styles.js'
import './header.js'
import './portrait.js'
import '#shared/icons/icon-camera.js'
import '#shared/icons/icon-photo-plus.js'

const fields = [
  ['name', 'Name'], ['nip05', 'NIP-05'], ['lightning', 'Lightning address']
]

f('z-profile-edit', ({ h, props }) => {
  const account = useAccount()
  return h`${h({ key: account.pubkey$() || 'signed-out' })`<z-profile-editor props=${{ route$: props.route$, person$: account.person$ }} />`}`
})

f('z-profile-editor', ({ h, props }) => {
  const view = useStore(() => ({
    draft$: {}, lightningHintId: `lightning-hint-${getRandomId()}`,
    details$ () { return profileDetails(props.person$()) },
    title$ () { return t('Edit profile') },
    banner$ () { return this.details$().banner },
    value (field) {
      const metadata = props.person$().profile ?? {}
      const rawLightning = [metadata.lud16, metadata.lud06].find(value => typeof value === 'string' && value.trim()) || ''
      const fallback = field === 'name' ? this.details$().name : field === 'lightning' ? this.details$().lightning?.value ?? rawLightning : metadata[field]
      return this.draft$()[field] ?? (typeof fallback === 'string' ? fallback : '')
    },
    lightningError$ () { const value = this.value('lightning'); return !!value.trim() && !parseProfileLightning(value) },
    change (field, value) {
      if (field !== 'lightning') { this.draft$(draft => ({ ...draft, [field]: value })); return }
      const parsed = parseProfileLightning(value)
      this.draft$(draft => ({ ...draft, lightning: value, lud16: parsed?.field === 'lud16' ? parsed.encoded : '', lud06: parsed?.field === 'lud06' ? parsed.encoded : '' }))
    }
  }))
  return h`
    <main class="profile-screen profile-editor">
      <style>${profileStyles + `
        z-profile-editor .profile-editor {
          .media-actions { display: flex; justify-content: center; gap: 16px; padding: 20px 24px 0; }
          .media-actions button { display: flex; align-items: center; justify-content: center; gap: 8px;
            min-height: 44px; padding: 8px 12px; border: 1px solid var(--z-border); border-radius: 12px;
            background: transparent; color: var(--z-muted); font-size: 13rem; opacity: .65; }
          .profile-form { display: flex; flex-direction: column; gap: 20px; padding: 28px 24px 0; }
          label { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: 13rem; color: var(--z-muted); }
          input, textarea { width: 100%; min-width: 0; padding: 13px 14px; border: 1px solid var(--z-border); border-radius: 12px;
            background: var(--z-control); color: var(--z-text); font: inherit; font-size: 16rem; line-height: 1.5; }
          input:focus-visible, textarea:focus-visible { outline: 2px solid var(--z-accent-text); outline-offset: 2px; }
          .field-hint { font-size: 12rem; line-height: 1.5; }
          .field-hint.invalid { color: var(--z-error); }
          textarea { min-height: 136px; resize: vertical; }
          input[readonly] { background: transparent; color: var(--z-muted); font-size: 13rem; }
        }
      `}</style>
      <z-profile-header props=${{ route$: props.route$, title$: view.title$, editing: true }} />
      <z-profile-portrait props=${{ person$: props.person$, banner$: view.banner$ }} />
      <div class="media-actions">
        <button type="button" disabled title=${t('Profile editing is not available yet.')}><icon-camera props=${{ size: '20px' }} /><span>${t('Change photo')}</span></button>
        <button type="button" disabled title=${t('Profile editing is not available yet.')}><icon-photo-plus props=${{ size: '20px' }} /><span>${t(view.banner$() ? 'Change cover' : 'Add cover')}</span></button>
      </div>
      <form class="profile-form" onsubmit=${event => event.preventDefault()}>
        <span hidden></span>
        ${fields.map(([field, label]) => h({ key: field })`<label><span>${t(label)}</span><input name=${field} type="text" .value=${view.value(field)} oninput=${event => view.change(field, event.target.value)} autocomplete="off" spellcheck=${field === 'name' ? 'true' : 'false'} autocapitalize=${field === 'name' ? 'sentences' : 'none'} aria-invalid=${String(field === 'lightning' && view.lightningError$())} aria-describedby=${field === 'lightning' ? view.lightningHintId : null}>${field === 'lightning' ? h`<span id=${view.lightningHintId} class=${`field-hint${view.lightningError$() ? ' invalid' : ''}`} role=${view.lightningError$() ? 'status' : null}>${t(view.lightningError$() ? 'Enter a Lightning address or LNURL-pay.' : 'Accepts name@domain, LNURL or lnurlp://…')}</span>` : null}</label>`)}
        <label><span>${t('Bio')}</span><textarea name="about" .value=${view.value('about')} oninput=${event => view.change('about', event.target.value)}></textarea></label>
        <label><span>npub</span><input name="npub" type="text" readonly .value=${view.details$().npub} placeholder=${t('Identifier unavailable')}></label>
        <label><span>${t('Bitcoin address')}</span><input name="bitcoin" type="text" readonly .value=${view.details$().bitcoin} placeholder=${t('Identifier unavailable')}></label>
        <p class="profile-hint">${t('Profile editing is not available yet.')}</p>
      </form>
    </main>
  `
})
