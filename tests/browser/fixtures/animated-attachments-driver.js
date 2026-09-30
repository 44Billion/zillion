import { f, useStore, useClosestStore } from '#f'
import { reportPrivateMedia } from '#services/private-media.js'
import { chatTimeline } from '#helpers/chat-timeline.js'
import { useAccount } from '#hooks/use-account.js'
import { prepareAttachment } from '#services/chat-attachments.js'

// Drive real preparation, storage and sending; no launcher APIs are replaced.
f('z-animation-test-driver', ({ h }) => {
  const account = useAccount()
  const page = useClosestStore('z-route-page', () => ({ isActive$: true }), { shouldCache: false })
  const fixture = useStore({ file$: null, upload$: null, cancelCount$: 0, retryCount$: 0 })
  window.animationTest = {
    account, fixture, page,
    showTransfer (id, overrides = {}, status = 'idle') {
      const message = chatTimeline(account.messages$(), { references: account.references$() }).find(message => message.id === id)
      const file = { ...message.attachment, peer: 'a'.repeat(64), ...overrides }
      reportPrivateMedia({ peer: file.peer, root: file.root, status })
      fixture.file$(file)
      return file
    },
    transfer (state) { const file = fixture.file$(); reportPrivateMedia({ peer: file.peer, root: file.root, ...state }) },
    async send (bytes, name, type) {
      const attachment = await prepareAttachment(new File([new Uint8Array(bytes)], name, { type }), { compress: false })
      try { return account.send(name, null, attachment) } catch (error) { await attachment.close(); throw error }
    }
  }
  return h`<div class="transfer-test-fixture" style="position:fixed;inset:60px 10px auto;z-index:1000;background:var(--z-bubble-incoming);max-width:340px;padding:8px;border-radius:12px;">
    ${fixture.file$() ? h`<z-chat-attachment props=${{ attachment$: fixture.file$, upload$: fixture.upload$, cancelUpload: () => fixture.cancelCount$(n => n + 1), retryUpload: () => fixture.retryCount$(n => n + 1) }} />` : null}
  </div>`
})
const host = document.createElement('div')
host.innerHTML = '<z-animation-test-driver></z-animation-test-driver>'
document.body.append(host)
