import { f } from '#f'
import { useAccount } from '#hooks/use-account.js'
import { prepareAttachment } from '#services/chat-attachments.js'
import { chatReferenceUri } from '#services/chat-references.js'
import { createFileMetadata } from 'libp2r2p/nip94'
import { getEventHash } from 'libp2r2p/event'
import { observePrivateMedia } from '#services/private-media.js'

window.contactBoot.mediaStates = []
observePrivateMedia(state => window.contactBoot.mediaStates.push({ root: state.root, status: state.status }))
window.contactBoot.seedCachedMedia = async (peer, input) => {
  const canvas = document.createElement('canvas')
  canvas.width = 320; canvas.height = 240
  const context = canvas.getContext('2d')
  context.fillStyle = '#238b45'; context.fillRect(0, 0, 320, 240)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  const source = input ? new File([new Uint8Array(input.bytes)], input.name, { type: input.type }) : new File([blob], 'cached-photo.png', { type: 'image/png' })
  const attachment = await prepareAttachment(source, { compress: false })
  if (input?.unknownSize) delete attachment.metadata.size
  const createdAt = Math.floor(Date.now() / 1000)
  const save = async event => {
    const result = await window.napp.eventStore.addPersonalCopy(event, { context: `dm:${peer}` })
    if (!result?.result?.ok) throw new Error('FIXTURE_STORAGE_FAILED')
  }
  try {
    for (const resource of [attachment.prepared, attachment.thumbnailPrepared].filter(Boolean)) {
      for await (const chunk of resource.chunks({ created_at: createdAt })) await save(chunk)
    }
    const file = { ...createFileMetadata({ ...attachment.metadata, created_at: createdAt }), pubkey: peer }
    await save(file)
    file.id = getEventHash(file)
    await save({ kind: 9, pubkey: peer, created_at: createdAt, tags: [['q', file.id, '', peer]], content: chatReferenceUri(file) })
    return attachment.metadata.root
  } finally { await attachment.close() }
}

f('z-contact-readiness-driver', ({ h }) => {
  window.contactBoot.account = useAccount()
  return h``
})
const host = document.createElement('div')
host.innerHTML = '<z-contact-readiness-driver></z-contact-readiness-driver>'
document.body.append(host)
