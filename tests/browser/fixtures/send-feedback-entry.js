import { installPrivateChatFixture } from '../private-chat-fixture.js'
import '#components/app.js'
import './route-driver.js'
import { f } from '#f'
import { useAccount } from '#hooks/use-account.js'
import { close } from '#shared/toast.js'

installPrivateChatFixture()
f('z-send-feedback-fixture', ({ h }) => {
  window.sendTest = { account: useAccount(), closeToast: close }
  return h`<z-app />`
})
