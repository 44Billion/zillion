import '#components/app.js'
import { f, useStore } from '#f'
import * as toast from '#shared/toast.js'
import { t } from '#i18n/messages.js'

// Compiled only for the browser test installation.
window.__toastTest = { ...toast, translated: () => t('More') }

f('z-toast-fixture', ({ h }) => {
  const view = useStore({ mounted$: true })
  window.__toastTest.view = view
  return h`<span hidden></span>${view.mounted$() ? h`<z-app />` : null}`
})
