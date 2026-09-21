import { f } from '#f'
import { useAccount } from '#hooks/use-account.js'
import { prepareAttachment } from '#services/chat-attachments.js'

// Drive real preparation, storage and sending; no launcher APIs are replaced.
f('z-animation-test-driver', ({ h }) => {
  const account = useAccount()
  window.animationTest = {
    account,
    async send (bytes, name, type) {
      const attachment = await prepareAttachment(new File([new Uint8Array(bytes)], name, { type }), { compress: false })
      try { return account.send(name, null, attachment) } catch (error) { await attachment.close(); throw error }
    }
  }
  return h`<span hidden></span>`
})
const host = document.createElement('div')
host.innerHTML = '<z-animation-test-driver></z-animation-test-driver>'
document.body.append(host)
