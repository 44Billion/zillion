import { f, useStore } from '#f'
import './avatar.js'
import '#shared/unread-badge.js'

f('z-home-conversation', ({ h, props }) => {
  const view = useStore({
    person$ () { return props.conversation$().contact },
    unread$ () { return props.conversation$().unread }
  })
  const conversation = props.conversation$()
  return h`
    <li class="conversation">
      <style>${`
        z-home-conversation .conversation {
          list-style: none;
          button {
            width: 100%; display: grid; grid-template-columns: 46px minmax(0, 1fr) auto;
            align-items: center; gap: 13px; padding: 11px 18px;
            text-align: start; border: 0; background: transparent; cursor: pointer;
          }
          button:active { background: var(--z-pressed); }
          button:focus-visible { outline-offset: -3px; }
          .avatar { width: 46px; height: 46px; border-radius: 50%; overflow: hidden; }
          .summary { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
          .name, .preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .name { font-size: 16px; font-weight: 550; line-height: 20px; letter-spacing: -.15px; }
          .preview { font-size: 13px; line-height: 18px; color: var(--z-muted); }
          .metadata { display: flex; flex-direction: column; align-items: end; gap: 6px; align-self: stretch; padding-top: 2px; }
          time { font-size: 10px; line-height: 15px; color: var(--z-subtle); white-space: nowrap; }
          .unread .name { font-weight: 650; }
          .unread time { color: var(--z-accent-text); }
        }
      `}</style>
      <button type="button" class=${conversation.unread ? 'unread' : ''} aria-disabled="true">
        <span class="avatar" aria-hidden="true"><z-home-avatar props=${{ person$: view.person$ }} /></span>
        <span class="summary">
          <span class="name">${conversation.contact.name}</span>
          <span class="preview">${conversation.message}</span>
        </span>
        <span class="metadata">
          <time datetime=${conversation.lastMessageAt}>${conversation.timeLabel}</time>
          <z-unread-badge props=${{ count$: view.unread$ }} />
        </span>
      </button>
    </li>
  `
})
