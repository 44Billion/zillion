import { createContacts as contacts } from '#services/contacts.js'
import { createPrivateChats as privateChats } from '#services/private-chats.js'
import { createChatOutbox } from '#services/chat-outbox.js'

const parameters = new URL(location.href).searchParams
const queueGate = Promise.withResolvers()
const boot = window.contactBoot = { started: performance.now(), negativeFrames: 0, transferFrames: 0, contactReads: 0, queueStarted: false, queueFinished: false }
boot.releaseQueue = queueGate.resolve
// Observe every intermediate DOM state, including a one-frame false invitation.
new MutationObserver(() => {
  if (document.querySelector('.media-transfer')) boot.transferFrames++
  if (document.querySelector('.route-page[data-active=true] .contact-invitation, .route-page[data-active=true] .contact-profile')) boot.negativeFrames++
}).observe(document.documentElement, { childList: true, subtree: true })

export function createPrivateChats (options) {
  return privateChats({
    ...options,
    openOutbox: async options => {
      boot.queueStarted = true
      if (parameters.has('holdOutbox')) await queueGate.promise
      const result = await createChatOutbox(options)
      boot.queueFinished = true
      return result
    }
  })
}

export function createContacts (options) {
  let held = parameters.has('holdContacts')
  let snapshot
  let state
  const writeGate = Promise.withResolvers()
  boot.releaseContactWrite = writeGate.resolve
  boot.failContacts = () => options.onState('unavailable')
  boot.releaseContacts = () => {
    held = false
    if (snapshot) options.onChange(...snapshot)
    if (state) options.onState(state)
  }
  const service = contacts({
    ...options,
    onChange: (...value) => { snapshot = value; if (!held) options.onChange(...value) },
    onState: value => {
      state = value
      if (value === 'loaded') { boot.contactReads++; boot.contactsMs = performance.now() - boot.started }
      if (!held || value === 'loading') options.onState(value)
    }
  })
  if (!parameters.has('holdContactWrite')) return service
  const set = service.set
  service.set = async (peer, included) => {
    boot.contactWriteStarted = true
    await writeGate.promise
    return set(peer, included)
  }
  return service
}
