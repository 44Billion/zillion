import { t } from '#i18n/messages.js'
import { f, useLocation, useStore, useTask } from '#f'
import '#shared/icons/icon-pin.js'
import '#shared/unread-badge.js'
import './avatar.js'

f('z-home-contact', ({ h, props }) => {
  const location = useLocation()
  const view = useStore({
    ready$: false,
    unread$ () { return props.person$().unread }
  })
  useTask(() => view.ready$(true), {
    when: 'visible',
    root: props.scrollRoot$(),
    rootMargin: '0px 84px'
  })

  const person = props.person$()
  return h`
    <button class="contact-item" type="button" data-contact-id=${person.id}
      onclick=${() => location.pushState({ fromHome: true }, '', `/chat/${encodeURIComponent(person.id)}`)}
      aria-label=${`${person.self ? t('You') : person.name}${person.pinned ? `, ${t('pinned')}` : ''}${person.unread ? `, ${t('{{count}} unread messages', { count: person.unread })}` : ''}`}>
      <style>${`
        z-home-contact .contact-item {
          scroll-snap-align: start;
          .contact-portrait { position: relative; width: 44px; height: 44px; flex: none; }
          .contact-avatar {
            display: block; width: 100%; height: 100%; border-radius: 50%;
            overflow: hidden; background: var(--z-control);
          }
          .contact-unread { position: absolute; right: -5px; bottom: -5px; display: flex; }
          .contact-unread .unread-badge { box-shadow: 0 0 0 2px var(--z-surface); }
          .contact-pin {
            position: absolute; left: -4px; top: -4px;
            display: grid; place-items: center; width: 18px; height: 18px;
            border-radius: 50%; background: var(--z-control); color: var(--z-text);
            box-shadow: 0 0 0 2px var(--z-surface);
          }
        }
      `}</style>
      <span class="contact-portrait" aria-hidden="true">
        <span class="contact-avatar">
          ${view.ready$() ? h`<z-home-avatar props=${{ person$: props.person$ }} />` : null}
        </span>
        ${person.pinned ? h`<span class="contact-pin"><icon-pin props=${{ size: '12px', weight: 'regular' }} /></span>` : null}
        <span class="contact-unread"><z-unread-badge props=${{ count$: view.unread$ }} /></span>
      </span>
      <span class="contact-name">${person.self ? t('You') : person.shortName}</span>
    </button>
  `
})
