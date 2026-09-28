import NMMR from 'nmmr'
import { prepareAttachment } from '#services/chat-attachments.js'
import { chatReferenceUri } from '#services/chat-references.js'
import { getEventHash } from 'libp2r2p/event'
import { RelayPool, relayPool } from 'libp2r2p/relay'
import { createPrivateMessenger } from 'libp2r2p/private-messenger'
import { createPrivateChats } from '#services/private-chats.js'
import { createChat } from '#services/self-chat.js'
const matchFilter = (filter, event) => (!filter.kinds || filter.kinds.includes(event.kind)) && (!filter.authors || filter.authors.includes(event.pubkey)) && (!filter.ids || filter.ids.includes(event.id)) && (filter.since == null || event.created_at >= filter.since) && (filter.until == null || event.created_at <= filter.until) && Object.entries(filter).filter(([key]) => key.startsWith('#')).every(([key, values]) => event.tags.some(tag => tag[0] === key.slice(1) && values.includes(tag[1])))

// Replace only the remote relay boundary. Channel wrapping, shared keys,
// messenger queues, signer calls and both event-store bridges remain real.
export function installPrivateChatFixture () {
  const events = new Map()
  const streams = new Set()
  const relay = 'wss://controlled.example'
  const relays = [{ relay, status: 'eose' }]
  const select = filter => [...events.values()].filter(event => matchFilter(filter, event))
  relayPool.getEvents = async filter => ({ result: select(filter).map(event => ({ event, relay })), errors: [], success: true, relays })
  const acknowledgements = []
  const publisher = new RelayPool({
    WebSocket: class ControlledRelaySocket {
      constructor (url) {
        this.url = url
        this.readyState = 0
        queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.() } })
      }

      send (raw) {
        const [op, event] = JSON.parse(raw)
        if (op !== 'EVENT' || window.dmTest?.rejectPublication) return
        if (!events.has(event.id)) {
          events.set(event.id, event)
          for (const stream of streams) if (matchFilter(stream.filter, event)) stream.push({ type: 'event', event, relay })
        }
        const acknowledge = () => { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(['OK', event.id, true, '']) }) }
        if (window.dmTest?.holdAcknowledgements) acknowledgements.push(acknowledge)
        else queueMicrotask(acknowledge)
      }

      close () {
        if (this.readyState === 3) return
        this.readyState = 3
        queueMicrotask(() => this.onclose?.({ code: 1000, reason: '', wasClean: true }))
      }
    }
  })
  // The installed library owns acknowledgement timing; only socket I/O is fake.
  relayPool.sendEvent = (event, urls, options = {}) => publisher.sendEvent(event, urls, {
    ...options,
    ...(window.dmTest?.rejectPublication ? { timeout: 25 } : {})
  })
  const subscribe = (filter, urls, { signal } = {}) => {
    const queue = select(filter).map(event => ({ type: 'event', event, relay })).concat({ type: 'eose', relays })
    let waiter; let closed = false
    const stream = {
      filter, ready: Promise.resolve({ relays }), readyRelays: Promise.resolve([relay]),
      push (value) { if (closed) return; if (waiter) { waiter({ value, done: false }); waiter = null } else queue.push(value) },
      [Symbol.asyncIterator] () { return this },
      next () { if (closed) return Promise.resolve({ done: true }); if (queue.length) return Promise.resolve({ done: false, value: queue.shift() }); return new Promise(resolve => { waiter = resolve }) },
      return () { closed = true; streams.delete(stream); waiter?.({ done: true }); return Promise.resolve({ done: true }) },
      stopAndDrain () { const pending = queue.splice(0); this.return(); return pending }
    }
    streams.add(stream)
    signal?.addEventListener('abort', () => stream.return(), { once: true })
    return stream
  }
  relayPool.getEventsFeedGenerator = subscribe
  relayPool.getLiveEventsGenerator = subscribe
  const fixture = { prepareAttachment, chatReferenceUri, getEventHash, errors: [], messages: [], outbox: [], events }
  fixture.checkTemporaryLeaves = async () => {
    const a = new NMMR(); const b = new NMMR()
    try {
      for (let index = 0; index < 130; index++) {
        await a.append(Uint8Array.of(index))
        await b.append(Uint8Array.of(255 - index))
      }
      let count = 0
      for await (const chunk of a.getChunks()) {
        if (chunk.contentBytes[0] !== count++) throw new Error('TEMPORARY_LEAVES_MIXED')
        NMMR.verifyProof({ ...chunk, root: a.getRoot() })
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      await a.close()
      let otherCount = 0
      for await (const chunk of b.getChunks()) {
        if (chunk.contentBytes[0] !== 255 - otherCount++) throw new Error('OTHER_TEMPORARY_LEAVES_LOST')
        NMMR.verifyProof({ ...chunk, root: b.getRoot() })
      }
      return { count, otherCount }
    } finally { await a.close(); await b.close() }
  }
  fixture.openPeer = async peer => {
    const owner = await window.nostr.peekPublicKey()
    const signer = window.napp.getWindowNostrFor(peer)
    const eventStore = window.napp.getWindowNappEventStoreFor(peer)
    const onError = error => fixture.errors.push(error.message)
    fixture.transport = createPrivateChats({
      owner: peer, signer, eventStore, onError,
      Messenger: async options => { fixture.messenger = await createPrivateMessenger(options); return fixture.messenger },
      onOutbox: entries => { fixture.outbox = entries; fixture.chat?.applyOutbox(entries) }
    })
    await fixture.transport.setPeers([owner])
    fixture.stopState = window.napp.onSignerStateChanged(state => fixture.transport.setState(state), { pubkey: peer })
    await fixture.stopState.ready
    await fixture.transport.setState(await window.napp.getSignerState({ pubkey: peer }))
    fixture.chat = createChat({ pubkey: peer, peer: owner, signer, eventStore, transport: fixture.transport, onMessages: messages => { fixture.messages = messages }, onError })
    await fixture.chat.start()
    fixture.signer = signer; fixture.eventStore = eventStore
  }
  fixture.pendingAcknowledgements = () => acknowledgements.length
  fixture.releaseAcknowledgements = () => { for (const acknowledge of acknowledgements.splice(0)) acknowledge() }
  fixture.close = async () => { fixture.stopState?.(); fixture.chat?.close(); await fixture.transport?.close(); await publisher.disconnectAll(); acknowledgements.length = 0 }
  window.dmTest = fixture
}
