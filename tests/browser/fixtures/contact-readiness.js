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
  const transport = privateChats({
    ...options,
    openOutbox: async options => {
      boot.queueStarted = true
      if (parameters.has('holdOutbox')) await queueGate.promise
      const result = await createChatOutbox(options)
      boot.queueFinished = true
      return result
    }
  })
  const setReady = transport.setPendingDecryptionReady
  transport.setPendingDecryptionReady = ready => {
    ;(boot.decryptionAdmissions ||= []).push({ ready, at: performance.now() - boot.started, rows: [...document.querySelectorAll('.route-page[data-active=true] .conversation button')].map(button => button.dataset.contactId) })
    return setReady(ready)
  }
  const setPriority = transport.setPendingDecryptionPriority
  transport.setPendingDecryptionPriority = peer => {
    ;(boot.decryptionPriorities ||= []).push(peer)
    return setPriority(peer)
  }
  const setPeers = transport.setPeers
  transport.setPeers = peers => {
    ;(boot.channelPreparations ||= []).push({
      at: performance.now() - boot.started, peers,
      rows: [...document.querySelectorAll('.route-page[data-active=true] .conversation button')].map(button => button.dataset.contactId)
    })
    return setPeers(peers)
  }
  return transport
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
