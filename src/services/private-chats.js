import { createPrivateMessageSession } from 'libp2r2p/private-messenger/session'
import { createPersonalCopyRecoveryStorage } from 'libp2r2p/private-messenger/event-store'
import { attachPrivateMediaTransport, reportPrivateMedia } from './private-media.js'
import { createMediaTransferPresentation } from './media-transfer-presentation.js'
import { createChatOutbox } from './chat-outbox.js'
export { wireEvent } from 'libp2r2p/private-messenger/session'

export function createPrivateChats (options) {
  const recovery = options.recoveryStorage === undefined
    ? createPersonalCopyRecoveryStorage({ eventStore: options.eventStore, signer: options.signer })
    : options.recoveryStorage
  const session = createPrivateMessageSession({
    ...options,
    FileTransfer: options.FileTransfer || createMediaTransferPresentation,
    recoveryStorage: recovery,
    openOutbox: options.openOutbox || createChatOutbox,
    openDownloads: options.openDownloads || (value => createChatOutbox({ ...value, namespace: 'downloads' })),
    onMedia: reportPrivateMedia
  })
  const detach = attachPrivateMediaTransport(session)
  return {
    ...session,
    setState: state => session.setAvailable(state.access === 'allowed' && state.connection === 'connected' && state.isLocked === false && state.isReadOnly === false),
    async close () { detach(); await session.close(); if (options.recoveryStorage === undefined) await recovery?.close() }
  }
}
