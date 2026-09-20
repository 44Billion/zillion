import { f, useLocation, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import { t } from '#i18n/messages.js'
import { useAccount } from '#hooks/use-account.js'
import { useRoutePage } from '#shared/route-page.js'
import { error } from '#shared/toast.js'
import { canShareText, shareText } from '#helpers/share-text.js'
import { profileDetails } from '#helpers/profile-presentation.js'
import people from '#views/contacts/fixtures/people.json'
import { fixtureCover } from './fixtures/index.js'
import { profileStyles } from './styles.js'
import './header.js'
import './portrait.js'
import './bio.js'
import '#shared/icons/icon-copy.js'
import '#shared/icons/icon-share-2.js'
import '#shared/icons/icon-check.js'
import '#shared/icons/icon-user-plus.js'
import '#shared/icons/icon-user-minus.js'
import '#shared/icons/icon-pin.js'
import '#shared/icons/icon-pencil.js'

f('z-profile-route', ({ h, props }) => {
  const account = useAccount()
  const person = props.route$().params?.contactId === 'user'
    ? account.person$()
    : people.find(person => person.id === props.route$().params?.contactId)
  if (!person) return h`<main class="profile-screen"><style>${profileStyles}</style><z-profile-header props=${{ route$: props.route$, title$: () => t('Profile') }} /><p class="profile-content">${t('Profile not found')}</p></main>`
  return h`${h({ key: `${person.id}:${person.pubkey ?? ''}` })`<f-to-signals props=${{
    from: { person }, render: ({ h, props: data }) => h`<z-profile props=${{ person$: data.person$, route$: props.route$ }} />`
  }} />`}`
})

f('z-profile', ({ h, props }) => {
  const location = useLocation()
  const page = useRoutePage()
  const view = useStore(() => ({
    saved$: props.person$().saved !== false,
    pinned$: !!props.person$().pinned && (props.person$().self || props.person$().saved !== false),
    copied$: '', busy$: false, alive: true,
    details$ () { return profileDetails(props.person$()) },
    title$ () { return t(props.person$().self ? 'My profile' : 'Profile') },
    banner$ () { return props.person$().previewCover ? fixtureCover : this.details$().banner },
    about$ () {
      const about = this.details$().about
      return about && !props.person$().self ? t(about) : about
    },
    toggleContact () {
      this.saved$(saved => !saved)
      if (!this.saved$()) this.pinned$(false)
    },
    async share () {
      const identifier = this.details$().identifier
      if (!identifier || this.busy$()) return
      this.busy$(true)
      try {
        const result = await shareText(identifier)
        if (this.alive && page.isActive$() && result === 'copied') this.copied$(identifier)
      } catch {
        if (this.alive && page.isActive$()) error(() => t('Could not copy identifier'))
      } finally {
        if (this.alive) this.busy$(false)
      }
    }
  }))
  useTask(({ cleanup }) => cleanup(() => { view.alive = false }))
  useTask(({ track, cleanup }) => {
    if (!track(() => view.copied$())) return
    const timer = setTimeout(() => view.copied$(''), 1600)
    cleanup(() => clearTimeout(timer))
  })
  useTask(({ track }) => { if (!track(() => page.isActive$())) view.copied$('') })
  const details = view.details$()
  const self = props.person$().self
  const copied = !!details.identifier && view.copied$() === details.identifier
  const share = !!details.identifier && canShareText(details.identifier)
  return h`
    <main class="profile-screen" data-profile-id=${props.person$().id}>
      <style>${profileStyles + `
        z-profile .profile-screen {
          .profile-identity { padding-top: 22px; text-align: center; }
          .profile-name { margin: 0; font-size: 24rem; font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
          .profile-name.unnamed { font-style: italic; font-weight: 400; color: var(--z-muted); }
          .profile-identifier { display: flex; justify-content: center; align-items: center; gap: 2px; min-width: 0; margin-top: 4px; }
          .identifier-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14rem; color: var(--z-muted); }
          .profile-share { display: grid; place-items: center; flex: none; width: 44px; height: 44px; padding: 0;
            border: 0; border-radius: 50%; background: transparent; color: var(--z-muted); }
          .profile-share:active:not(:disabled) { background: var(--z-pressed); }
          .profile-share:disabled { opacity: .5; }
          .profile-share[data-copied=true] { color: var(--z-success); }
        }
      `}</style>
      <z-profile-header props=${{ route$: props.route$, title$: view.title$ }} />
      <z-profile-portrait props=${{ person$: props.person$, banner$: view.banner$ }} />
      <div class="profile-content">
        <div class="profile-identity">
          <h2 class=${`profile-name${details.name ? '' : ' unnamed'}`}>${details.name || t('No name')}</h2>
          <div class="profile-identifier">
            <span class="identifier-text" title=${details.identifier}>${details.identifierLabel || t('Identifier unavailable')}</span>
            <button class="profile-share" type="button" ?disabled=${!details.identifier || view.busy$()} data-copied=${String(copied)} aria-label=${t(copied ? 'Copied' : share ? 'Share identifier' : 'Copy identifier')} onclick=${view.share}>
              ${copied ? h`<icon-check props=${{ size: '22px', weight: 'regular' }} />` : share ? h`<icon-share-2 props=${{ size: '20px' }} />` : h`<icon-copy props=${{ size: '20px' }} />`}
            </button>
          </div>
        </div>
        ${view.about$() ? h`<z-profile-bio props=${{ text$: view.about$ }} />` : null}
        <div class="profile-actions">
          ${self
? h`<button class="profile-action edit-profile" type="button" onclick=${() => location.pushState({ fromProfile: true }, '', '/profile/user/edit')}><icon-pencil props=${{ size: '22px' }} /><span>${t('Edit profile')}</span></button>`
: h`<button class=${`profile-action contact-toggle${view.saved$() ? '' : ' primary'}`} type="button" aria-pressed=${String(view.saved$())} onclick=${view.toggleContact}>
            ${view.saved$() ? h`<icon-user-minus props=${{ size: '22px' }} />` : h`<icon-user-plus props=${{ size: '22px' }} />`}<span>${t(view.saved$() ? 'Remove contact' : 'Add contact')}</span>
          </button>`}
          ${self || view.saved$() ? h`<button class="profile-action pin-toggle" type="button" aria-pressed=${String(view.pinned$())} onclick=${() => view.pinned$(pinned => !pinned)}><icon-pin props=${{ size: '22px', weight: view.pinned$() ? 'regular' : 'light' }} /><span>${t(view.pinned$() ? 'Unpin' : 'Pin')}</span></button>` : null}
        </div>
      </div>
    </main>
  `
})
