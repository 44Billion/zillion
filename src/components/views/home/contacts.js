import { f, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import '#shared/icons/icon-chevron-down.js'
import './avatar.js'

f('z-home-contacts', ({ h, props }) => {
  const view = useStore({
    listRef$: null,
    capacity$: 5,
    visible$ () { return props.contacts$().slice(0, this.capacity$()) }
  })
  useTask(({ track, cleanup }) => {
    const list = track(() => view.listRef$())
    if (!list) return
    const resize = () => view.capacity$(Math.max(1, Math.floor(list.clientWidth / 56)))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(list)
    cleanup(() => observer.disconnect())
  }, { after: 'rendering' })

  return h`
    <section class="contact-strip" aria-label="Pinned and recent contacts">
      <style>${`
        z-home-contacts .contact-strip {
          display: flex; gap: 8px; align-items: start;
          padding: 4px 18px 22px; border-bottom: 1px solid var(--z-border);
          .contact-list { flex: 1; min-width: 0; display: grid; gap: 4px; }
          button {
            display: flex; flex-direction: column; align-items: center; gap: 8px;
            min-width: 0; border: 0; border-radius: 12px; padding: 3px 0 0 0;
            background: transparent; cursor: pointer; color: var(--z-muted);
            font-size: 11px; line-height: 16px;
          }
          button:active { background: var(--z-pressed); }
          .contact-avatar, .more-icon {
            width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex: none;
          }
          .contact-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .more { width: 48px; flex: none; }
          .more-icon { display: grid; place-items: center; background: var(--z-control); color: var(--z-muted); }
        }
      `}</style>
      <div class="contact-list" ref=${view.listRef$} style=${`grid-template-columns: repeat(${view.visible$().length}, minmax(0, 1fr));`}>
        ${view.visible$().map(person => h({ key: person.id })`
          <f-to-signals props=${{
            from: { person },
            render: ({ h, props }) => h`
              <button type="button" aria-label=${props.person$().name} aria-disabled="true">
                <span class="contact-avatar" aria-hidden="true"><z-home-avatar props=${{ person$: props.person$ }} /></span>
                <span class="contact-name">${props.person$().shortName}</span>
              </button>
            `
          }} />
        `)}
      </div>
      <button class="more" type="button" aria-label="More contacts" aria-disabled="true">
        <span class="more-icon" aria-hidden="true"><icon-chevron-down props=${{ size: '20px', weight: 'regular' }} /></span>
        <span>More</span>
      </button>
    </section>
  `
})
