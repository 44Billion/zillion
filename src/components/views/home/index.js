import { f, useStore } from '#f'
import '#f/components/f-to-signals.js'
import data from './fixtures/home.json'
import './header.js'
import './contacts.js'
import './conversation.js'

f('z-home', ({ h }) => {
  const view = useStore(() => ({
    user$: data.user,
    contacts$: data.contacts.toSorted((a, b) => Number(b.pinned) - Number(a.pinned)),
    conversations$: data.conversations.toSorted((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).map(conversation => ({
      ...conversation,
      contact: data.contacts.find(contact => contact.id === conversation.contactId)
    }))
  }))
  return h`
    <main class="home">
      <style>${`
        z-home .home {
          width: 100%; max-width: 718px; min-height: 100svh; margin-inline: auto;
          padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);
          background: var(--z-surface);
          .conversations { margin: 0; padding: 6px 0 18px; }
          @media (min-width: 719px) { border-inline: 1px solid var(--z-border); }
        }
      `}</style>
      <z-home-header props=${{ user$: view.user$ }} />
      <z-home-contacts props=${{ contacts$: view.contacts$ }} />
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
