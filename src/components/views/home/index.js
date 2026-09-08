import { f, useStore } from '#f'
import '#f/components/f-to-signals.js'
import data from './fixtures/home.json'
import { useHeaderCollapse } from './hooks/use-header-collapse.js'
import './header.js'
import './contacts.js'
import './conversation.js'

f('z-home', ({ h }) => {
  const view = useStore(() => ({
    homeRef$: null,
    headerSpaceRef$: null,
    contactsRef$: null,
    user$: data.user,
    contacts$: data.contacts.toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, 'en')).map(contact => ({
      ...contact,
      unread: data.conversations.find(conversation => conversation.contactId === contact.id)?.unread ?? 0
    })),
    conversations$: data.conversations.toSorted((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).map(conversation => ({
      ...conversation,
      contact: data.contacts.find(contact => contact.id === conversation.contactId)
    }))
  }))
  useHeaderCollapse(view)
  return h`
    <main class="home" ref=${view.homeRef$}>
      <style>${`
        z-home .home {
          width: 100%; max-width: 718px; min-height: 100svh; margin-inline: auto;
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
      <ul class="conversations" aria-label="Direct messages">
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
