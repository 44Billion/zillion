import { f, useLocation } from '#f'
import { t } from '#i18n/messages.js'
import { contactIdentifier } from '#helpers/contact-search.js'
import '#views/home/avatar.js'

f('z-contact-row', ({ h, props }) => {
  const location = useLocation()
  const person = props.person$()
  const identifier = contactIdentifier(person)
  return h`
    <button class="contact-row" type="button" data-person-id=${person.id}
      onclick=${() => location.pushState({ fromContacts: true }, '', `/chat/${encodeURIComponent(person.id)}`)}>
      <style>${`
        z-contact-row .contact-row {
          display: flex; align-items: center; gap: 14px; width: calc(100% + 24px); min-height: 76px;
          margin-inline: -12px; padding: 12px; border: 0; border-radius: 12px; background: transparent;
          color: var(--z-text); text-align: start; cursor: pointer;
          &:active { background: var(--z-pressed); }
          .person-avatar { width: 48px; height: 48px; border-radius: 50%; overflow: hidden; flex: none; }
          .person-details { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
          .person-name { font-size: 16rem; font-weight: 600; }
          .person-identifier, .person-status { font-size: 13rem; color: var(--z-muted); }
          .person-status { font-size: 12rem; }
          .person-name, .person-identifier { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        }
      `}</style>
      <span class="person-avatar" aria-hidden="true"><z-home-avatar props=${{ person$: props.person$ }} /></span>
      <span class="person-details">
        <span class="person-name">${person.self ? t('You') : person.name}</span>
        <span class="person-identifier" title=${identifier}>${person.self ? t('Notes to yourself') : identifier}</span>
        ${person.saved === false ? h`<span class="person-status">${t('Not in your contacts')}</span>` : null}
      </span>
    </button>
  `
})
