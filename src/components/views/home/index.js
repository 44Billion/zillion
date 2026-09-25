import { chatTimeline } from '#helpers/chat-timeline.js'
import { t } from '#i18n/messages.js'
import { i18n } from '#i18n/index.js'
import { f, useStore } from '#f'
import '#f/components/f-to-signals.js'
import data from './fixtures/home.json'
import { demoEnabled } from '#services/demo.js'
import { useAccount } from '#hooks/use-account.js'
import { useHeaderCollapse } from './hooks/use-header-collapse.js'
import './header.js'
import './contacts.js'
import './conversation.js'

f('z-home', ({ h }) => {
  const account = useAccount()
  const view = useStore(() => ({
    homeRef$: null,
    headerSpaceRef$: null,
    contactsRef$: null,
    user$: account.person$,
    contacts$ () {
      return [...account.people$().filter(person => person.saved !== false), account.person$()].toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, 'en')).map(contact => ({
        ...contact,
        unread: data.conversations.find(conversation => conversation.contactId === contact.id)?.unread ?? 0
      }))
    },
    conversations$ () {
      const self = account.person$()
      const latest = account.messages$().at(-1)
      const date = latest ? new Date(latest.created_at * 1000) : null
      // Preview from the resolved message model so a kind 9 that only
      // references a file shows its caption/filename instead of the URI.
      const preview = latest ? chatTimeline([latest], { locale: i18n.getLocale(), references: account.references$(), t })[0] : null
      const previewText = preview ? (preview.attachment ? (preview.caption || preview.attachment.filename || '') : preview.displayText) : ''
      const rows = demoEnabled ? data.conversations : [{ id: 'user', contactId: 'user', unread: 0 }, ...account.people$().filter(person => person.saved).map(person => ({ id: person.id, contactId: person.id, unread: 0 }))]
      return rows.map(conversation => {
        if (conversation.contactId === self.id) {
          return {
            ...conversation, contact: self, real: true, unread: 0,
            message: previewText, lastMessageAt: date?.toISOString() ?? '',
            timeLabel: date?.toLocaleTimeString(i18n.getLocale(), { hour: '2-digit', minute: '2-digit' }) ?? ''
          }
        }
        if (demoEnabled) return { ...conversation, contact: account.personFor(conversation.contactId) }
        const person = account.personFor(conversation.contactId)
        const message = account.conversations$()[person.id]?.messages?.at(-1)
        return { ...conversation, contact: person, real: true, message: message?.content || '', lastMessageAt: message ? new Date(message.created_at * 1000).toISOString() : '', timeLabel: '' }
      }).toSorted((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    }
  }))
  useHeaderCollapse(view)
  return h`
    <main class="home" ref=${view.homeRef$}>
      <style>${`
        z-home .home {
          width: 100%; max-width: var(--z-mobile-width); min-height: 100svh; margin-inline: auto;
          --home-header-collapse: 0;
          --home-header-expanded-height: calc(84px + env(safe-area-inset-top));
          --home-header-height: calc(var(--home-header-expanded-height) - 37px * var(--home-header-collapse));
          padding-bottom: env(safe-area-inset-bottom);
          background: var(--z-surface);
          .home-header-space {
            position: sticky; top: 0; z-index: 3;
            height: var(--home-header-expanded-height); pointer-events: none;
          }
          .contacts-divider { position: sticky; top: var(--home-header-height); z-index: 2; height: 1px; background: var(--z-border); }
          .conversations { margin: 0; padding: 6px 0 18px; }
          @media (min-width: 719px) { border-inline: 1px solid var(--z-border); }
        }
      `}</style>
      <div class="home-header-space" ref=${view.headerSpaceRef$}>
        <z-home-header props=${{ user$: view.user$ }} />
      </div>
      <div class="home-contacts-space" ref=${view.contactsRef$}>
        <z-home-contacts props=${{ contacts$: view.contacts$ }} />
      </div>
      <div class="contacts-divider" aria-hidden="true"></div>
      <ul class="conversations" aria-label=${t('Direct messages')}>
        ${view.conversations$().map(conversation => h({ key: conversation.id })`
          <f-to-signals props=${{
            from: { conversation },
            render: ({ h, props }) => h`<z-home-conversation props=${{ conversation$: props.conversation$ }} />`
          }} />
        `)}
      </ul>
    </main>
  `
})
