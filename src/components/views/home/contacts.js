import { t } from '#i18n/messages.js'
import { f, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import '#shared/icons/icon-chevron-down.js'
import './contact.js'

f('z-home-contacts', ({ h, props }) => {
  const view = useStore({ listRef$: null })
  useTask(({ track, cleanup }) => {
    const list = track(() => view.listRef$())
    if (!list) return
    let step = 56
    let target = null
    let lastWheelAt = -Infinity
    let lastDirection = 0
    const reset = () => { target = null }
    const resize = () => {
      const width = list.getBoundingClientRect().width
      if (!width) return
      const index = Math.round(list.scrollLeft / step)
      step = width / Math.max(1, Math.floor(width / 56))
      list.style.setProperty('--contact-step', `${step}px`)
      list.scrollTo({ left: index * step, behavior: 'instant' })
      reset()
    }
    const move = index => {
      target = Math.max(0, Math.min(index * step, list.scrollWidth - list.clientWidth))
      list.scrollTo({ left: target, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
    const wheel = event => {
      if (event.ctrlKey) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const direction = Math.sign(delta)
      if (!direction) return
      const current = target ?? list.scrollLeft
      const limit = list.scrollWidth - list.clientWidth
      if ((direction < 0 && current <= 1) || (direction > 0 && current >= limit - 1)) return
      event.preventDefault()
      // Coalesce a wheel burst while keeping each destination on a contact boundary.
      const now = performance.now()
      if (direction === lastDirection && now - lastWheelAt < 120) return
      lastWheelAt = now
      lastDirection = direction
      move(Math.round(current / step) + direction)
    }
    const keydown = event => {
      const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
      if (!direction) return
      event.preventDefault()
      move(Math.round((target ?? list.scrollLeft) / step) + direction)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(list)
    list.addEventListener('wheel', wheel, { passive: false })
    list.addEventListener('keydown', keydown)
    list.addEventListener('pointerdown', reset, { passive: true })
    list.addEventListener('scrollend', reset)
    cleanup(() => {
      observer.disconnect()
      list.removeEventListener('wheel', wheel)
      list.removeEventListener('keydown', keydown)
      list.removeEventListener('pointerdown', reset)
      list.removeEventListener('scrollend', reset)
    })
  }, { after: 'rendering' })

  return h`
    <section class="contact-strip" aria-label=${t('Pinned contacts, then alphabetical contacts')}>
      <style>${`
        z-home-contacts .contact-strip {
          display: flex; gap: 8px; align-items: start;
          padding: 0 18px 22px;
          .contact-list {
            flex: 1; min-width: 0; display: grid; grid-auto-flow: column;
            grid-auto-columns: var(--contact-step, 56px);
            overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
            scroll-snap-type: x mandatory;
          }
          .contact-list::-webkit-scrollbar { display: none; }
          .contact-list:focus-visible { outline: 2px solid var(--z-accent-text); outline-offset: 2px; }
          button {
            display: flex; flex-direction: column; align-items: center; gap: 9px;
            min-width: 0; border: 0; border-radius: 12px; padding: 7px 0 0;
            background: transparent; cursor: pointer; color: var(--z-muted);
            font-size: 11rem; line-height: 16px;
          }
          button:active { background: var(--z-pressed); }
          .contact-list button:focus-visible { outline-offset: -2px; }
          .contact-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .more { width: 48px; flex: none; }
          .more-icon {
            display: grid; place-items: center; width: 44px; height: 44px;
            border-radius: 50%; background: var(--z-control); color: var(--z-muted);
          }
        }
      `}</style>
      <div class="contact-list" ref=${view.listRef$} tabindex="0" role="group" aria-label=${t('Contacts; scroll horizontally for more')}>
        <span hidden></span>
        ${props.contacts$().map(person => h({ key: person.id })`
          <f-to-signals props=${{
            from: { person },
            render: ({ h, props }) => h`<z-home-contact props=${{ person$: props.person$, scrollRoot$: view.listRef$ }} />`
          }} />
        `)}
      </div>
      ${FUTURE_FEATURES_ENABLED
? h`<button class="more" type="button" aria-label=${t('More contacts')} aria-disabled="true">
        <span class="more-icon" aria-hidden="true"><icon-chevron-down props=${{ size: '20px', weight: 'regular' }} /></span>
        <span>${t('More')}</span>
      </button>`
: null}
    </section>
  `
})
