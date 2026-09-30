import { prepareAttachment as prepare } from '#services/chat-attachments.js'
export { attachmentCatalog } from '#services/chat-attachments.js'

// Pause only the prepared file's iterator. Real signing, persistence and the
// durable outbox still run through the launcher and vault after release.
export async function prepareAttachment (...args) {
  const attachment = await prepare(...args)
  if (window.holdAttachment) {
    const gate = Promise.withResolvers()
    window.releaseAttachment = gate.resolve
    const chunks = attachment.prepared.chunks.bind(attachment.prepared)
    attachment.prepared.chunks = async function * (options) {
      window.attachmentWaiting = true
      await gate.promise
      yield * chunks(options)
    }
  }
  return attachment
}
