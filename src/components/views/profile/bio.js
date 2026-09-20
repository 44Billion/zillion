import { f, useStore, useTask } from '#f'
import { t } from '#i18n/messages.js'

f('z-profile-bio', ({ h, props }) => {
  const view = useStore({ textRef$: null, lines$: 2, more$: false })
  useTask(({ track }) => { track(() => props.text$()); view.lines$(2) })
  useTask(({ track, cleanup }) => {
    const [element, lines] = track(() => [view.textRef$(), view.lines$(), props.text$()])
    if (!element) return
    element.style.setProperty('-webkit-line-clamp', String(lines))
    const measure = () => view.more$(element.scrollHeight > element.clientHeight + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    cleanup(() => observer.disconnect())
  }, { after: 'rendering' })
  return h`
    <div class="profile-bio">
      <style>${`
        z-profile-bio .profile-bio {
          margin-top: 24px;
          button { display: block; width: 100%; border: 0; padding: 0; background: transparent; color: var(--z-text);
            font-size: 15rem; line-height: 1.6; text-align: start; border-radius: 6px; user-select: text; }
          .bio-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
          .bio-more { display: block; margin-top: 8px; font-size: 13rem; color: var(--z-accent-text); }
        }
      `}</style>
      <button type="button" class="expand-bio" ?disabled=${!view.more$()} aria-expanded=${String(view.lines$() > 2)} onclick=${() => view.lines$(lines => lines + 2)}>
        <span class="bio-text" ref=${view.textRef$}>${props.text$()}</span>
        ${view.more$() ? h`<span class="bio-more">${t('Show more')}</span>` : null}
      </button>
    </div>
  `
})
