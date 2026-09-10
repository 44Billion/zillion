import { f, useTask } from '#f'
import { themeCss } from '#assets/styles/theme.js'
import globalCss from '#assets/styles/global.css'
import { useInitI18n } from '#i18n/index.js'
import { t } from '#i18n/messages.js'
import '#shared/toast.js'
import './router.js'

const style = document.createElement('style')
style.textContent = themeCss + globalCss
document.head.append(style)

f('z-app', ({ h }) => {
  useInitI18n()
  useTask(({ track }) => {
    const description = track(() => t('Zillion — private conversations'))
    document.querySelector('meta[name="description"]')?.setAttribute('content', description)
  })
  return h`<z-router /><z-toast />`
})
