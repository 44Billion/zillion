import { f } from '#f'
import { t } from '#i18n/messages.js'
import '#f/components/f-to-signals.js'
import './message.js'

f('z-chat-day', ({ h, props }) => {
  const day = props.day$()
  return h`
    <span hidden></span>
    ${day.label ? h`<li class="chat-date" data-day=${day.key}>${day.label}</li>` : null}
    ${day.messages.flatMap(message => {
      const item = h({ key: message.id })`<f-to-signals props=${{
        from: { message },
        render: ({ h, props: data }) => h`<z-chat-message props=${{
          message$: data.message$, messages$: props.messages$, person$: props.person$,
          activeId$: props.activeId$, onReply: props.onReply, onRetry: props.onRetry, onDelete: props.onDelete,
          references$: props.references$, resolve$: props.resolve$
        }} />`
      }} />`
      if (props.dividerId$?.() !== message.id) return [item]
      return [h({ key: `${message.id}:unread` })`<li class="unread-divider" data-unread-divider=${message.id}>${t('Unread messages')}</li>`, item]
    })}
  `
})
