import { demoEnabled } from '#services/demo.js'
import { f, useLocation, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import { t } from '#i18n/messages.js'
import { i18n } from '#i18n/index.js'
import { contactQuery, matchesContact, matchesProfile } from '#helpers/contact-search.js'
import { useAccount } from '#hooks/use-account.js'
import { useRoutePage } from '#shared/route-page.js'
import '#shared/icons/icon-chevron-down.js'
import '#shared/icons/icon-user-plus.js'
import '#shared/icons/icon-search.js'
import '#shared/icons/icon-x.js'
import { npubDecode } from 'libp2r2p/nip19'
import { queryProfile } from 'libp2r2p/nip05'
import './row.js'

f('z-contacts', ({ h, props }) => {
  const location = useLocation()
  const page = useRoutePage()
  const account = useAccount()
  const view = useStore(() => ({
    query$: '', foundId$: null,
    inputRef$: null,
    add$ () { return props.route$().url.pathname === '/contacts/add' },
    search$ () { return contactQuery(this.query$()) },
    contacts$ () {
      const own = { ...account.person$(), nip05: account.person$().profile?.nip05 }
      return [own, ...account.people$().filter(person => person.saved)].filter(person => matchesContact(person, this.search$()))
        .toSorted((a, b) => Number(!!b.self) - Number(!!a.self) || a.name.localeCompare(b.name, i18n.getLocale()))
    },
    found$ () {
      if (!this.search$().text || this.contacts$().some(person => matchesProfile(person, this.search$()))) return []
      const found = this.foundId$() ? account.personFor(this.foundId$()) : null
      return [...account.people$().filter(person => !person.saved && matchesProfile(person, this.search$())), ...(found && !found.saved ? [found] : [])]
    },
    rows$ () {
      let previous = ''
      return this.contacts$().map(person => {
        const letter = person.self || this.search$().text ? '' : (person.name[0] || '#').toLocaleUpperCase(i18n.getLocale())
        const heading = letter !== previous ? letter : ''
        previous = letter
        return { person, heading }
      })
    },
    back () {
      if (props.route$().state?.fromContacts || props.route$().state?.fromHome) location.back()
      else location.replaceState({}, '', this.add$() ? '/contacts' : '/')
    },
    clear () { this.query$(''); this.inputRef$()?.focus() }
  }))
  useTask(({ track }) => {
    const input = track(() => page.isActive$() && view.add$() && view.inputRef$())
    if (input) input.focus({ preventScroll: true })
  }, { after: 'rendering' })
  useTask(({ track, cleanup }) => {
    const query = track(() => view.search$())
    if (demoEnabled) return
    view.foundId$(null)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const pubkey = query.npub ? npubDecode(query.npub) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.text) ? (await queryProfile(query.text, { signal: controller.signal }))?.pubkey : null
        if (!pubkey || controller.signal.aborted) return
        view.foundId$(pubkey)
        await account.loadPerson(pubkey)
      } catch {}
    }, 300)
    cleanup(() => { clearTimeout(timer); controller.abort() })
  })
  const searching = !!view.search$().text
  const showList = searching || !view.add$()
  return h`
    <main class="contacts-screen">
      <style>${`
        z-contacts .contacts-screen {
          min-height: 100svh; background: var(--z-surface); padding-bottom: max(24px, env(safe-area-inset-bottom));
          @media (min-width: 719px) { border-inline: 1px solid var(--z-border); }
          .contacts-top { position: sticky; top: 0; z-index: 2; padding: env(safe-area-inset-top) 18px 14px; background: var(--z-surface); }
          .contacts-heading { display: flex; align-items: center; gap: 10px; min-height: 68px; }
          h1 { flex: 1; margin: 0; font-size: 22rem; line-height: 1.2; font-weight: 650; letter-spacing: -.4px; }
          .icon-button { display: grid; place-items: center; flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--z-text); cursor: pointer; }
          .icon-button:active { background: var(--z-pressed); }
          .clear-search[hidden] { display: none; }
          .add-contact { color: var(--z-accent-text); }
          .contact-search { display: flex; align-items: center; gap: 10px; min-height: 48px; padding-inline: 14px 4px; border-radius: 14px; background: var(--z-control); color: var(--z-muted); }
          .contact-search:focus-within { outline: 2px solid var(--z-accent-text); outline-offset: 2px; }
          input { flex: 1; min-width: 0; width: 100%; padding: 12px 0; border: 0; outline: none; background: transparent; color: var(--z-text); font-size: 16rem; }
          input::placeholder { color: var(--z-muted); opacity: 1; }
          input::-webkit-search-cancel-button { display: none; }
          .search-help { margin: 14px 0 2px; color: var(--z-muted); font-size: 13rem; line-height: 1.5; }
          .contacts-body { padding: 0 24px; }
          ul { list-style: none; margin: 0; padding: 0; }
          .letter { margin: 16px -24px 0; padding: 12px 24px 0; border-top: 1px solid var(--z-border); font-size: 12rem; color: var(--z-muted); font-weight: 600; }
          .result-heading { margin: 22px 0 6px; font-size: 13rem; font-weight: 600; color: var(--z-muted); }
          .empty-state { padding: 60px 12px; text-align: center; color: var(--z-muted); }
          .empty-symbol { display: grid; place-items: center; width: 72px; height: 72px; margin: 0 auto 22px; border-radius: 50%; background: var(--z-control); color: var(--z-accent-text); }
          .empty-state h2 { color: var(--z-text); font-size: 18rem; font-weight: 600; }
          .empty-state p { margin: 10px auto; max-width: 300px; font-size: 14rem; line-height: 1.6; }
        }
      `}</style>
      <div class="contacts-top">
        <header class="contacts-heading">
          <button type="button" class="icon-button contacts-back" onclick=${view.back} aria-label=${t('Back')}><icon-chevron-down props=${{ rotate: 90, size: '24px', weight: 'regular' }} /></button>
          <h1>${t(view.add$() ? 'Add contact' : 'Contacts')}</h1>
          ${view.add$() ? null : h`<button type="button" class="icon-button add-contact" aria-label=${t('Add contact')} onclick=${() => location.pushState({ fromContacts: true }, '', '/contacts/add')}><icon-user-plus props=${{ size: '26px', weight: 'regular' }} /></button>`}
        </header>
        <div class="contact-search" role="search">
          <icon-search props=${{ size: '22px' }} />
          <input ?data-route-autofocus=${view.add$()} ref=${view.inputRef$} type="search" .value=${view.query$()} oninput=${event => view.query$(event.target.value)}
            aria-label=${t('Name or identifier')} placeholder=${t('Name or identifier')} autocomplete="off" autocapitalize="none" spellcheck="false">
          <button type="button" class="icon-button clear-search" ?hidden=${!view.query$()} onclick=${view.clear} aria-label=${t('Clear search')}><icon-x props=${{ size: '20px' }} /></button>
        </div>
        ${view.add$() ? h`<p class="search-help">${t('Search by npub, nprofile or NIP-05.')}</p>` : null}
      </div>
      <div class="contacts-body">
        ${showList
? h`
          ${searching && view.contacts$().length ? h`<h2 class="result-heading">${t('Your contacts')}</h2>` : null}
          <ul aria-label=${t('Contacts')}>
            <span hidden></span>
            ${view.rows$().map(({ person, heading }) => h({ key: person.id })`<li>
              ${heading ? h`<h2 class="letter">${heading}</h2>` : null}
              <f-to-signals props=${{ from: { person }, render: ({ h, props }) => h`<z-contact-row props=${{ person$: props.person$ }} />` }} />
            </li>`)}
          </ul>
        `
: null}
        <div aria-live="polite" aria-atomic="true">
          ${searching && !view.contacts$().length && !view.found$().length ? h`<div class="empty-state"><h2>${t('No results found')}</h2><p>${t('Check the name or paste a complete identifier.')}</p></div>` : null}
          ${view.found$().length ? h`<h2 class="result-heading">${t('Person found')}</h2>` : null}
        </div>
        <ul aria-label=${t('Person found')}>
          <span hidden></span>
          ${view.found$().map(person => h({ key: `found:${person.id}` })`<li><f-to-signals props=${{ from: { person }, render: ({ h, props }) => h`<z-contact-row props=${{ person$: props.person$ }} />` }} /></li>`)}
        </ul>
        ${!searching && view.add$() ? h`<div class="empty-state"><span class="empty-symbol" aria-hidden="true"><icon-user-plus props=${{ size: '34px' }} /></span><h2>${t('Find someone')}</h2><p>${t('Paste an identifier to see their profile.')}</p></div>` : null}
      </div>
    </main>
  `
})
