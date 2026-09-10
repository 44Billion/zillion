import { t } from '#i18n/messages.js'
import { f } from '#f'

f('z-unread-badge', ({ h, props }) => {
  const count = props.count$()
  if (!(count > 0)) return
  return h`
    <span class="unread-badge" aria-label=${t('{{count}} unread messages', { count })}>
      <style>${`
        z-unread-badge .unread-badge {
          display: inline-flex; align-items: center; justify-content: center;
          flex: none; min-width: 20px; height: 20px; padding: 0 5px;
          border-radius: 999px; background: var(--z-primary); color: var(--z-on-primary);
          font-size: 11rem; font-weight: 700; line-height: 1;
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
      `}</style>
      ${count > 99 ? '99+' : count}
    </span>
  `
})
