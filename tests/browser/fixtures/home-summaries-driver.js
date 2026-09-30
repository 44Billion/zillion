import './contact-readiness-driver.js'
import { createFileMetadata } from 'libp2r2p/nip94'
import { nfileEncode } from 'libp2r2p/nip19'
import { getEventHash } from 'libp2r2p/event'
import { chatReferenceUri } from '#services/chat-references.js'

const boot = window.contactBoot
boot.reads = []
boot.holdHistory = () => { boot.historyGate = Promise.withResolvers(); boot.eoseGate = Promise.withResolvers() }
boot.releaseEose = () => { boot.eoseGate?.resolve(); boot.eoseGate = null }
boot.releaseHistory = () => { boot.historyGate?.resolve(); boot.historyGate = null }
const stores = new WeakMap()
// Observe real bridge calls; permissions, signatures, encryption and storage
// remain owned by the actual launcher/vault, with no synthetic read results.
boot.observeStore = store => {
  if (!stores.has(store)) {
    stores.set(store, new Proxy(store, {
      get (target, key) {
        const value = target[key]
        if (typeof value !== 'function') return value
        return (...args) => {
          if (['query', 'subscribe'].includes(key)) boot.reads.push({ method: key, filter: args[0], options: args[1] })
          const result = value.apply(target, args)
          if (key !== 'subscribe' || !args[0]['#k']?.includes('9') || args[0].limit !== 25 || !boot.historyGate) return result
          // Delay delivery, without replacing any real history results.
          const gate = boot.historyGate
          const eose = boot.eoseGate
          const closed = Promise.withResolvers()
          let finished = false
          return {
            [Symbol.asyncIterator] () { return this },
            async next () {
              await Promise.race([gate.promise, closed.promise])
              if (finished) return { done: true }
              const item = await result.next()
              if (item.value?.type === 'eose') await Promise.race([eose.promise, closed.promise])
              return finished ? { done: true } : item
            },
            return () { finished = true; closed.resolve(); return result.return() }
          }
        }
      }
    }))
  }
  return stores.get(store)
}
boot.seedMessage = async ({ peer, at, text = '', filename, caption = '' }) => {
  const owner = await window.nostr.peekPublicKey()
  const context = `dm:${peer}`
  const save = async event => {
    const result = await window.napp.eventStore.addPersonalCopy(event, { context })
    if (!result?.result?.ok) throw new Error('FIXTURE_STORAGE_FAILED')
  }
  let content = text
  const tags = []
  if (filename) {
    const root = 'd'.repeat(64)
    const file = { ...createFileMetadata({ url: `https://nostr.alt/${nfileEncode({ root, mime: 'application/pdf', filename })}?localOnly=1`, root, mime: 'application/pdf', service: 'irfs', size: 500, caption, created_at: at }), pubkey: owner }
    await save(file)
    file.id = getEventHash(file)
    content = chatReferenceUri(file)
    tags.push(['q', file.id, '', owner])
  }
  const message = { kind: 9, pubkey: owner, created_at: at, tags, content }
  await save(message)
  return getEventHash(message)
}
