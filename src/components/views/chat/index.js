import { f, useLocation, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import { t } from '#i18n/messages.js'
import { i18n } from '#i18n/index.js'
import { useRoutePage } from '#shared/route-page.js'
import home from '#views/home/fixtures/home.json'
import { getMessages } from './fixtures/index.js'
import './header.js'
import './message.js'
import './composer.js'
import { useAccount } from '#hooks/use-account.js'

f('z-chat-route', ({ h, props }) => {
  const location = useLocation()
  const account = useAccount()
  const route = props.route$()
  const person = [...home.contacts, account.person$()].find(person => person.id === route.params?.contactId)
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
  const account = useAccount()
  const view = useStore(() => ({
    timelineRef$: null,
    screenRef$: null,
    activeId$: null,
    replyTo$: null,
    real$ () { return props.person$().self === true },
    messages$ () {
      if (!this.real$()) return getMessages(props.person$())
      return account.messages$().map(event => ({
        id: event.id, text: event.content, real: true, outgoing: true,
        replyTo: event.tags.find(tag => tag[0] === 'q')?.[1],
        time: new Date(event.created_at * 1000).toLocaleTimeString(i18n.getLocale(), { hour: '2-digit', minute: '2-digit' }),
        date: new Date(event.created_at * 1000).toLocaleDateString(i18n.getLocale()),
        datetime: new Date(event.created_at * 1000).toISOString()
      }))
    },
    reply (id) { this.replyTo$(id); this.activeId$(null) },
    reply$ () { return this.messages$().find(message => message.id === this.replyTo$()) },
    canSend$ () { return this.real$() && account.ready$() && !!account.pubkey$() },
    send (text) { return account.send(text, this.replyTo$()) }
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
          .retry-btn { margin-left: 8px; }
        }
      `}</style>
      <z-chat-header props=${{ person$: props.person$, entry$: props.entry$, route$: props.route$ }} />
      <div class="chat-timeline" ref=${view.timelineRef$}>
        ${view.real$() ? h`<div class="chat-date" role="status" ?hidden=${!account.error$() && account.ready$() && !!account.pubkey$() && view.messages$().length > 0}>${account.error$() ? t('Could not load conversation') : !account.ready$() ? t('Loading conversation') : !account.pubkey$() ? t('Sign in to save notes') : !view.messages$().length ? t('Notes to yourself') : ''}${account.error$() ? h` <button type="button" class="retry-btn" onclick=${() => account.retry$(value => value + 1)}>${t('Retry')}</button>` : null}</div>` : h`<div class="chat-date">${t('Today')}</div>`}
        <ol class="message-list" aria-label=${t('Messages')}>
          <span hidden></span>
          ${view.messages$().map(message => h({ key: message.id })`
            <f-to-signals props=${{
              from: { message },
              render: ({ h, props: data }) => h`<z-chat-message props=${{ message$: data.message$, messages$: view.messages$, person$: props.person$, activeId$: view.activeId$, onReply: view.reply }} />`
            }} />
          `)}
        </ol>
      </div>
      <z-chat-composer props=${{ canSend$: view.canSend$, send: view.send, reply$: view.reply$, clearReply: () => view.replyTo$(null) }} />
    </main>
  `
})
