import { f, useLocation, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import { t } from '#i18n/messages.js'
import { useAccount } from '#hooks/use-account.js'
import { profileDetails } from '#helpers/profile-presentation.js'
import { error } from '#shared/toast.js'
import { fixtureCover } from './fixtures/index.js'
import { profileStyles } from './styles.js'
import './header.js'
import './portrait.js'
import './bio.js'
import './identifiers.js'
import '#shared/icons/icon-user-plus.js'
import '#shared/icons/icon-user-minus.js'
import '#shared/icons/icon-pin.js'
import '#shared/icons/icon-pencil.js'

f('z-profile-route', ({ h, props }) => {
  const account = useAccount()
  useTask(({ track }) => { const id = track(() => props.route$().params?.contactId); if (id !== 'user') account.loadPerson?.(id) })
  const person = props.route$().params?.contactId === 'user'
    ? account.person$()
    : account.personFor(props.route$().params?.contactId)
  if (!person) return h`<main class="profile-screen"><style>${profileStyles}</style><z-profile-header props=${{ route$: props.route$, title$: () => t('Profile') }} /><p class="profile-content">${t('Profile not found')}</p></main>`
  return h`${h({ key: `${person.id}:${person.pubkey ?? ''}` })`<f-to-signals props=${{
    from: { person }, render: ({ h, props: data }) => h`<z-profile props=${{ person$: data.person$, route$: props.route$ }} />`
  }} />`}`
})

f('z-profile', ({ h, props }) => {
  const location = useLocation()
  const account = useAccount()
  const view = useStore(() => ({
    saved$ () { return props.person$().demo ? this.demoSaved$() : props.person$().saved !== false },
    demoSaved$: props.person$().saved !== false, busy$: false,
    pinned$: !!props.person$().pinned && (props.person$().self || props.person$().saved !== false),
    details$ () { return profileDetails(props.person$()) },
    title$ () { return t(props.person$().self ? 'My profile' : 'Profile') },
    banner$ () { return props.person$().previewCover ? fixtureCover : this.details$().banner },
    about$ () {
      const about = this.details$().about
      return about && props.person$().demo ? t(about) : about
    },
    async toggleContact () {
      if (this.busy$()) return
      const included = !this.saved$()
      this.busy$(true)
      try {
        if (props.person$().demo) this.demoSaved$(included)
        else await account.setContact(props.person$().pubkey, included)
        if (!included) this.pinned$(false)
      } catch { error(() => t('Could not update contacts')) } finally { this.busy$(false) }
    }
  }))
  const details = view.details$()
  useTask(({ track }) => { if (!track(() => view.saved$()) && !props.person$().self) view.pinned$(false) })
  const self = props.person$().self
  return h`
    <main class="profile-screen" data-profile-id=${props.person$().id}>
      <style>${profileStyles + `
        z-profile .profile-screen {
          .profile-identity { padding-top: 22px; text-align: center; }
          .profile-name { margin: 0; font-size: 24rem; font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
          .profile-name.unnamed { font-style: italic; font-weight: 400; color: var(--z-muted); }
        }
      `}</style>
      <z-profile-header props=${{ route$: props.route$, title$: view.title$ }} />
      <z-profile-portrait props=${{ person$: props.person$, banner$: view.banner$, viewable: true }} />
      <div class="profile-content">
        <div class="profile-identity">
          <h2 class=${`profile-name${details.name ? '' : ' unnamed'}`}>${details.name || t('No name')}</h2>
          <z-profile-identifiers props=${{ details$: view.details$ }} />
        </div>
        ${view.about$() ? h`<z-profile-bio props=${{ text$: view.about$ }} />` : null}
        <div class="profile-actions">
          ${self
? h`<button class="profile-action edit-profile" type="button" onclick=${() => location.pushState({ fromProfile: true }, '', '/profile/user/edit')}><icon-pencil props=${{ size: '22px' }} /><span>${t('Edit profile')}</span></button>`
: h`<button class=${`profile-action contact-toggle${view.saved$() ? '' : ' primary'}`} type="button" aria-pressed=${String(view.saved$())} onclick=${view.toggleContact} ?disabled=${view.busy$()}>
            ${view.saved$() ? h`<icon-user-minus props=${{ size: '22px' }} />` : h`<icon-user-plus props=${{ size: '22px' }} />`}<span>${t(view.saved$() ? 'Remove contact' : 'Add contact')}</span>
          </button>`}
          ${self || view.saved$() ? h`<button class="profile-action pin-toggle" type="button" aria-pressed=${String(view.pinned$())} onclick=${() => view.pinned$(pinned => !pinned)}><icon-pin props=${{ size: '22px', weight: view.pinned$() ? 'regular' : 'light' }} /><span>${t(view.pinned$() ? 'Unpin' : 'Pin')}</span></button>` : null}
        </div>
      </div>
    </main>
  `
})
