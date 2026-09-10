import { f, useLocation, useStore, useTask } from '#f'
import { useAnchoredMenu } from '#hooks/use-anchored-menu.js'
import { t } from '#i18n/messages.js'
import { useRoutePage } from '#shared/route-page.js'
import '#views/home/avatar.js'
import '#shared/icons/icon-chevron-down.js'
import '#shared/icons/icon-dots-vertical.js'
import '#shared/icons/icon-bolt.js'
import '#shared/icons/icon-trash.js'

f('z-chat-header', ({ h, props }) => {
  const location = useLocation()
  const menu = useAnchoredMenu({ placement: 'bottom-end', gap: 6 })
  const page = useRoutePage()
  useTask(({ track }) => { if (!track(() => page.isActive$())) menu.setIsOpen(false) })
  const view = useStore(() => ({
    menuId: `chat-menu-${Math.random().toString(36).slice(2)}`,
    back () {
      if (props.entry$()) return
      if (props.route$().state?.fromHome) location.back()
      else location.replaceState({}, '', '/')
    },
    key (event) {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')]
      const current = items.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
      items[next]?.focus()
    }
  }))
  useTask(({ track, cleanup }) => {
    if (!track(() => menu.isOpen$())) return
    const pointer = event => {
      if (!menu.anchorRef$()?.contains(event.target) && !menu.floatingRef$()?.contains(event.target)) menu.setIsOpen(false)
    }
    const key = event => {
      if (event.key === 'Escape') { menu.setIsOpen(false); menu.anchorRef$()?.focus() }
    }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('focusin', pointer)
    document.addEventListener('keydown', key)
    cleanup(() => {
      document.removeEventListener('pointerdown', pointer)
      document.removeEventListener('focusin', pointer)
      document.removeEventListener('keydown', key)
    })
  })
  useTask(({ track }) => {
    const element = track(() => menu.isOpen$() && menu.position$() && menu.floatingRef$())
    element?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true })
  }, { after: 'rendering' })
  const person = props.person$()
  return h`
    <header class="chat-header">
      <style>${`
        z-chat-header .chat-header {
          position: absolute; top: 0; left: max(8px, env(safe-area-inset-left)); right: max(8px, env(safe-area-inset-right));
          z-index: 4; height: calc(48px + env(safe-area-inset-top));
          padding-block: calc(2px + env(safe-area-inset-top)) 2px;
          display: flex; align-items: center; gap: 6px;
          .header-pill { border-radius: 24px; background: var(--z-chat-overlay); backdrop-filter: blur(12px); box-shadow: 0 2px 8px var(--z-shadow); }
          button { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; flex: none; cursor: pointer; }
          button[aria-disabled=true] { cursor: default; }
          button:active { background: var(--z-pressed); }
          .chat-identity { min-width: 0; height: 44px; display: flex; flex: 1; align-items: center; gap: 8px; padding: 4px 10px 4px 5px; }
          .chat-avatar { width: 36px; height: 36px; border-radius: 50%; overflow: hidden; flex: none; }
          .chat-name { min-width: 0; }
          h1 { margin: 0; font-size: 15rem; line-height: 1.25; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .chat-subtitle { font-size: 11rem; line-height: 1.25; color: var(--z-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .chat-header-actions { display: flex; flex: none; }
          .entry-logo { width: 28px; height: 28px; position: relative; }
          .entry-logo img { position: absolute; width: 125%; height: 125%; left: -12.5%; top: -12.5%; }
        }
        z-chat-header .chat-menu {
          z-index: 30; padding: 6px; min-width: 220px; max-width: calc(100vw - 16px);
          background: var(--z-chat-overlay); backdrop-filter: blur(12px); color: var(--z-text);
          border: 1px solid var(--z-border); border-radius: 14px; box-shadow: 0 6px 24px var(--z-shadow);
          button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 10px 12px; border: 0; border-radius: 8px; background: transparent; text-align: start; font-size: 14rem; }
          button:active { background: var(--z-pressed); }
          .delete-chat { color: var(--z-error); }
        }
      `}</style>
      <div class="header-pill">
        <button class="chat-back" type="button" onclick=${view.back} aria-label=${t(props.entry$() ? 'Open Zillion' : 'Back')}
          aria-disabled=${props.entry$() ? 'true' : 'false'}>
          ${props.entry$() ? h`<span class="entry-logo"><img src="/zillion.icon.svg" alt=""></span>` : h`<icon-chevron-down props=${{ rotate: 90, size: '24px', weight: 'regular' }} />`}
        </button>
      </div>
      <div class="chat-identity header-pill">
        <span class="chat-avatar" aria-hidden="true"><z-home-avatar props=${{ person$: props.person$ }} /></span>
        <div class="chat-name"><h1>${person.self ? t('You') : person.name}</h1><div class="chat-subtitle">${t(person.self ? 'Notes to yourself' : 'last seen recently')}</div></div>
      </div>
      <div class="chat-header-actions header-pill">
        ${CHAT_ATTENTION_ENABLED ? h`<button class="chat-attention" type="button" aria-label=${t('Get attention')} aria-disabled="true"><icon-bolt props=${{ size: '22px', weight: 'regular' }} /></button>` : null}
        <button class="chat-more" type="button" ref=${menu.anchorRef$} aria-label=${t('Chat options')} aria-haspopup="menu"
          aria-expanded=${String(menu.isOpen$())} aria-controls=${view.menuId} onclick=${() => menu.setIsOpen(open => !open)}>
          <icon-dots-vertical props=${{ size: '22px', weight: 'regular' }} />
        </button>
      </div>
      ${menu.isVisible$()
? h`
        <div class="chat-menu" id=${view.menuId} role="menu" aria-label=${t('Chat options')} ref=${menu.floatingRef$} style=${menu.floatingStyle$()} onkeydown=${view.key}>
          ${CHAT_ATTENTION_ENABLED ? h`<button class="chat-attention-option" type="button" role="menuitem" aria-disabled="true"><icon-bolt props=${{ size: '20px', weight: 'regular' }} /><span>${t('Get attention')}</span></button>` : null}
          <button class="delete-chat" type="button" role="menuitem" aria-disabled="true"><icon-trash props=${{ size: '20px', weight: 'regular' }} /><span>${t('Delete chat content')}</span></button>
        </div>
      `
: null}
    </header>
  `
})
