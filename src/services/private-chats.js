import { createPrivateMessenger } from 'libp2r2p/private-messenger'
import { getEventHash, isValidEvent, isSerializableEvent } from 'libp2r2p/event'
import { decodeIrfsChunk, IRFS_CHUNK_BYTES } from 'libp2r2p/irfs'
import { decodeFileMetadata } from 'libp2r2p/nip94'
import NMMR from 'nmmr'
import { createChatOutbox } from './chat-outbox.js'
import { messengerSigner } from './messenger-signer.js'

export function wireEvent (value, owner) {
  const event = { kind: value.kind, created_at: value.created_at, tags: structuredClone(value.tags), content: value.content, pubkey: value.pubkey || owner }
  if (value.sig) return { ...event, id: value.id, sig: value.sig }
  return event
}
const retryable = error => !/DENIED|PERMISSION|REVOKED|READ_ONLY|INVALID|BLOCKED|EXPIRED|NOT_IN_PERSONA/i.test(`${error?.code || ''} ${error?.message || ''}`)

export function createPrivateChats ({ owner, signer, eventStore, onOutbox = () => {}, onError = () => {}, Messenger = createPrivateMessenger, openOutbox = createChatOutbox }) {
  const userSigner = messengerSigner(signer)
  const peers = new Set()
  const channels = new Map()
  const deniedPeers = new Set()
  const entries = new Map()
  const cancelled = new Set()
  let messenger
  let storage
  let initialized
  let closed = false
  let available = false
  let lifecycle = 0
  let configuring = Promise.resolve()
  let sending
  let draining
  const idleWaiters = new Set()
  const settled = () => { if (!sending && !draining) { for (const resolve of idleWaiters) resolve(); idleWaiters.clear() } }
  const emit = () => onOutbox([...entries.values()].filter(entry => !entry.deletion))
  const ready = () => (initialized ??= (async () => {
    storage = await openOutbox({ owner, signer })
    for (const entry of await storage.list()) entries.set(entry.id, entry)
    emit()
  })().catch(async error => { await storage?.close(); storage = null; initialized = null; throw error }))
  async function configure () {
    if (closed || !available) return
    await ready()
    const version = lifecycle
    const values = []
    for (const peer of peers) {
      if (deniedPeers.has(peer)) continue
      let channel = channels.get(peer)
      if (!channel) {
        try {
          const scoped = messengerSigner(signer.withSharedKey(peer, 'dm'))
          channel = { signer: scoped, pubkey: await scoped.getPublicKey(), mode: 'seeder', seeders: [peer] }
          channels.set(peer, channel)
        } catch (error) { if (!retryable(error)) deniedPeers.add(peer); onError(error); continue }
      }
      if (closed || !available || version !== lifecycle) return
      values.push(channel)
    }
    if (!messenger) messenger = await Messenger({ userSigner, channels: [], useContentKeys: false, onMessageQueued: () => drain(), onError })
    if (closed || !available || version !== lifecycle) { await messenger.pause('signer'); return }
    await messenger.update({ channels: values })
    await messenger.resume('signer')
    drain(); pump()
  }
  function schedule () {
    const work = configuring.catch(() => {}).then(configure)
    configuring = work
    work.catch(onError)
    return work
  }
  async function drain () {
    if (draining || closed || !available || !messenger) return
    draining = true
    const deferred = []
    try {
      while (true) {
        if (closed || !available) break
        const delivery = await messenger.nextMessage()
        if (!delivery) break
        const { message, ack, nack } = delivery
        try {
          const peer = [...channels].find(([, value]) => value.pubkey === message.channelPubkey)?.[0]
          if (!peer) { deferred.push(nack); continue }
          if (message.senderPubkey !== peer) { await ack(); continue }
          if (!peers.has(peer)) { deferred.push(nack); continue }
          const event = wireEvent(message.event, peer)
          const valid = event.pubkey === peer || message.provenance === 'hearsay' || message.provenance === 'signed'
          if (!valid || !isSerializableEvent(event) || ![5, 9, 1063, 34601].includes(event.kind) || (event.sig && !isValidEvent(event)) || getEventHash(event) !== message.event.id) { await ack(); continue }
          if (event.kind === 34601) {
            try { decodeIrfsChunk(event) } catch (error) { onError(error); await ack(); continue }
          }
          if (event.kind === 5 && (message.provenance === 'hearsay' || event.pubkey !== peer)) { await ack(); continue }
          if (!available || closed) { await nack(); break }
          const saved = await eventStore.addPersonalCopy(event, { context: `dm:${peer}`, hearsay: message.provenance === 'hearsay' })
          if (!saved?.result?.ok && !['blocked', 'expired'].includes(saved?.result?.code)) throw Object.assign(new Error('INBOX_STORAGE_FAILED'), { code: saved?.result?.code?.toUpperCase() })
          await ack()
        } catch (error) {
          await nack()
          onError(error)
          // Retain the failed record and suspend network ingestion until recovery.
          await messenger.pause('storage')
          break
        }
      }
    } finally { await Promise.all(deferred.map(nack => nack())); draining = false; settled() }
  }
  async function publish (peer, event) {
    if (deniedPeers.has(peer)) throw new Error('PERMISSION_DENIED')
    if (!available || !peers.has(peer) || !channels.has(peer)) throw new Error('CHAT_UNAVAILABLE')
    const options = { channelPubkey: channels.get(peer)?.pubkey, receiverPubkeys: [peer] }
    const report = event.sig ? await messenger.broadcastEvent({ ...options, event }) : await messenger.broadcastRumor({ ...options, rumor: event })
    // Published is relay acceptance, never a peer receipt.
    if (!report?.delivery?.reports?.length || !report.delivery.reports.every(item => item.success)) throw new Error('MESSAGE_NOT_PUBLISHED')
  }
  async function pump () {
    if (sending || !available || closed || !messenger || !storage) return
    sending = true
    try {
      for (const entry of entries.values()) {
        if (closed || !available) break
        if ((entry.peer !== owner && !peers.has(entry.peer)) || entry.failed || cancelled.has(entry.id)) continue
        entry.status = 'pending'; emit()
        try {
          const active = async () => {
            if (storage.has && !await storage.has(entry.id)) cancelled.add(entry.id)
            if (closed || !available || cancelled.has(entry.id) || (entry.peer !== owner && !peers.has(entry.peer))) throw new Error('CHAT_UNAVAILABLE')
          }
          // Personal copies must commit even if publishing attachment bytes
          // fails offline. Remote progress remains independently retryable.
          for (let index = 0; index < entry.events.length; index++) {
            await active()
            const event = entry.events[index]
            if (!entry.localSaved[index]) {
              const hearsay = !event.sig && event.pubkey !== owner
              const result = await eventStore.addPersonalCopy(event, { context: `dm:${entry.peer}`, hearsay })
              if (result?.result?.code === 'blocked') { cancelled.add(entry.id); await active() }
              if (!result?.result?.ok) throw Object.assign(new Error('MESSAGE_STORAGE_FAILED'), { code: result?.result?.code?.toUpperCase() })
              entry.localSaved[index] = true
              await storage.put(entry, { existing: true })
            }
          }
          // Read/publish one chunk at a time. Progress is durable after each
          // accepted chunk; replay after interruption keeps its original identity.
          for (; entry.peer !== owner && entry.fileIndex < entry.files.length; entry.fileIndex++, entry.chunkIndex = 0) {
            const file = entry.files[entry.fileIndex]
            for (; entry.chunkIndex < Math.ceil(file.size / IRFS_CHUNK_BYTES); entry.chunkIndex++) {
              await active()
              const d = NMMR.deriveChunkId(file.root, entry.chunkIndex)
              const { results } = await eventStore.query({ kinds: [34601], '#d': [d], limit: 1 })
              const chunk = results[0]
              if (!chunk || decodeIrfsChunk(chunk).root !== file.root) { if (file.optional) break; throw new Error('FILE_UNAVAILABLE') }
              await publish(entry.peer, wireEvent(chunk, owner))
              await active()
              await storage.put({ ...entry, chunkIndex: entry.chunkIndex + 1 }, { existing: true })
            }
          }
          for (; entry.index < entry.events.length; entry.index++) {
            await active()
            const event = entry.events[entry.index]
            if (entry.peer !== owner) await publish(entry.peer, event)
            await active()
            await storage.put({ ...entry, index: entry.index + 1 }, { existing: true })
          }
          await storage.remove(entry.id)
          entries.delete(entry.id)
          emit()
        } catch (error) {
          if (cancelled.has(entry.id)) { await storage.remove(entry.id); entries.delete(entry.id) } else { entry.status = 'error'; entry.failed = true; entry.retryable = retryable(error); await storage.put(entry, { existing: true }).catch(onError); onError(error) }
          emit()
        }
      }
    } finally { sending = false; settled() }
  }
  return {
    async setPeers (values) {
      peers.clear(); for (const peer of values) if (peer !== owner) peers.add(peer)
      for (const peer of deniedPeers) if (!peers.has(peer)) deniedPeers.delete(peer)
      lifecycle++
      return schedule()
    },
    async setState (state) {
      available = state.access === 'allowed' && state.connection === 'connected' && state.isLocked === false && state.isReadOnly === false
      lifecycle++
      if (!available) { await messenger?.pause('signer'); return }
      await ready()
      for (const entry of entries.values()) if (entry.retryable) entry.failed = false
      await messenger?.resume('storage')
      return schedule()
    },
    async enqueue ({ peer, event, context = [], requiredFiles = [], deletion = false }) {
      if (closed || !available || (peer !== owner && !peers.has(peer))) throw new Error('CHAT_UNAVAILABLE')
      await ready()
      const main = wireEvent(event, owner)
      const id = getEventHash(main)
      const events = [...context.map(value => wireEvent(value, owner)), main]
      const files = events.filter(value => value.kind === 1063).map(value => ({ ...decodeFileMetadata(value), optional: !requiredFiles.includes(getEventHash(value)) })).filter(file => file.service === 'irfs')
      const entry = { id, peer, event: { ...main, id }, events, files, index: 0, fileIndex: 0, chunkIndex: 0, localSaved: context.map(() => true).concat(false), status: 'pending', deletion }
      await storage.put(entry)
      entries.set(id, entry); emit(); pump()
      return id
    },
    async retry (id) {
      await ready()
      const entry = entries.get(id)
      if (entry) { entry.failed = false; if (deniedPeers.delete(entry.peer)) await schedule(); return pump() }
    },
    async cancel (id) {
      cancelled.add(id)
      await ready()
      entries.delete(id)
      await storage.remove(id)
      emit()
    },
    async close () {
      closed = true; available = false; lifecycle++
      await Promise.allSettled([configuring, initialized])
      await messenger?.pause('closed')
      if (sending || draining) await new Promise(resolve => idleWaiters.add(resolve))
      await messenger?.close()
      await storage?.close()
    }
  }
}
