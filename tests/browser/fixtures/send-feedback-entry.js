import { installPrivateChatFixture } from '../private-chat-fixture.js'
import '#components/app.js'
import './route-driver.js'
import { f } from '#f'
import { useAccount } from '#hooks/use-account.js'
import { close } from '#shared/toast.js'

window.__ZILLION_SEND_TRACE__ = true
window.__optimisticSendTraces = []
window.addEventListener('zillion:send-trace', event => window.__optimisticSendTraces.push(event.detail))

installPrivateChatFixture()
f('z-send-feedback-fixture', ({ h }) => {
  window.sendTest = { account: useAccount(), closeToast: close }
  return h`<z-app />`
})
