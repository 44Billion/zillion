import { f, useLocation, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import { t } from '#i18n/messages.js'
import { useRoutePage } from '#shared/route-page.js'
import home from '#views/home/fixtures/home.json'
import { getMessages } from './fixtures/index.js'
import './header.js'
import './message.js'
import './composer.js'

f('z-chat-route', ({ h, props }) => {
  const location = useLocation()
  const route = props.route$()
  const person = [...home.contacts, home.user].find(person => person.id === route.params?.contactId)
  const entry = route.url.searchParams.entry === '1'
  if (!person) {
    return h`
    <main class="chat-missing">
      <style>${'z-chat-route .chat-missing { max-width: var(--z-mobile-width); margin: auto; padding: 48px 24px; font-size: 16rem; } z-chat-route .chat-missing h1 { font-size: 22rem; }'}</style>
      <h1>${t('Conversation not found')}</h1>
      ${entry ? null : h`<button type="button" onclick=${() => location.replaceState({}, '', '/')}>${t('Back')}</button>`}
    </main>
  `
  }
  return h`${h({ key: `${person.id}:${entry}` })`
    <f-to-signals props=${{
      from: { person, entry },
      render: ({ h, props: data }) => h`<z-chat props=${{ person$: data.person$, entry$: data.entry$, route$: props.route$ }} />`
    }} />
  `}`
})

f('z-chat', ({ h, props }) => {
  const page = useRoutePage()
  const view = useStore(() => ({
    timelineRef$: null,
    screenRef$: null,
    activeId$: null,
    messages$: getMessages(props.person$())
  }))
  useTask(({ track }) => { if (!track(() => page.isActive$())) view.activeId$(null) })
  useTask(({ track, cleanup }) => {
    const timeline = track(() => view.timelineRef$())
    if (!timeline) return
    let atBottom = true
    const resize = () => { if (atBottom) timeline.scrollTop = timeline.scrollHeight }
    const observer = new ResizeObserver(resize)
    observer.observe(timeline)
    observer.observe(timeline.querySelector('.message-list'))
    resize()
    const dismiss = event => {
      const message = event.target.closest?.('.chat-bubble')?.closest('[data-message-id]')
      if (!event.target.closest?.('.message-actions') && message?.dataset.messageId !== view.activeId$()) view.activeId$(null)
    }
    const key = event => {
      if (!page.isActive$()) return
      if (event.key === 'Escape' && view.activeId$()) {
        const selected = timeline.querySelector('.chat-bubble.selected')
        view.activeId$(null)
        selected?.focus({ preventScroll: true })
      }
    }
    const scroll = () => {
      atBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 24
      view.activeId$(null)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', key)
    timeline.addEventListener('scroll', scroll)
    cleanup(() => {
      observer.disconnect()
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', key)
      timeline.removeEventListener('scroll', scroll)
    })
  }, { after: 'rendering' })
  // Keep the composer inside the visible viewport when a mobile keyboard opens.
  useTask(({ track, cleanup }) => {
    const screen = track(() => view.screenRef$())
    if (!screen) return
    const viewport = window.visualViewport
    const resize = () => {
      screen.style.height = `${viewport?.height ?? window.innerHeight}px`
      screen.style.top = `${viewport?.offsetTop ?? 0}px`
    }
    resize()
    viewport?.addEventListener('resize', resize)
    viewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    cleanup(() => {
      viewport?.removeEventListener('resize', resize)
      viewport?.removeEventListener('scroll', resize)
      window.removeEventListener('resize', resize)
    })
  }, { after: 'rendering' })
  return h`
    <main class="chat-screen" ref=${view.screenRef$} data-contact-id=${props.person$().id}>
      <style>${`
        z-chat .chat-screen {
          position: absolute; top: 0; left: 0; right: 0; margin-inline: auto;
          width: 100%; max-width: var(--z-mobile-width); height: 100dvh;
          display: flex; flex-direction: column; background: var(--z-chat-canvas);
          border-inline: 1px solid var(--z-border);
          .chat-timeline { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; padding: calc(60px + env(safe-area-inset-top)) 12px 12px; }
          .message-list { list-style: none; padding: 0; margin: 0; }
          .chat-date { width: fit-content; margin: 8px auto 16px; padding: 4px 12px; border-radius: 14px; background: var(--z-chat-overlay); color: var(--z-muted); font-size: 12rem; line-height: 1.4; }
        }
      `}</style>
      <z-chat-header props=${{ person$: props.person$, entry$: props.entry$, route$: props.route$ }} />
      <div class="chat-timeline" ref=${view.timelineRef$}>
        <div class="chat-date">${t('Today')}</div>
        <ol class="message-list" aria-label=${t('Messages')}>
          <span hidden></span>
          ${view.messages$().map(message => h({ key: message.id })`
            <f-to-signals props=${{
              from: { message },
              render: ({ h, props: data }) => h`<z-chat-message props=${{ message$: data.message$, messages$: view.messages$, person$: props.person$, activeId$: view.activeId$ }} />`
            }} />
          `)}
        </ol>
      </div>
      <z-chat-composer />
    </main>
  `
})
