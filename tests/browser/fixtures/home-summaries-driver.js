import './contact-readiness-driver.js'
import { createFileMetadata } from 'libp2r2p/nip94'
import { nfileEncode } from 'libp2r2p/nip19'
import { getEventHash } from 'libp2r2p/event'
import { chatReferenceUri } from '#services/chat-references.js'

const boot = window.contactBoot
boot.reads = []
const stores = new WeakMap()
// Observe real bridge calls; permissions, signatures, encryption and storage
// remain owned by the actual launcher/vault, with no synthetic read results.
boot.observeStore = store => {
  if (!stores.has(store)) {
    stores.set(store, new Proxy(store, {
      get (target, key) {
        const value = target[key]
        if (typeof value !== 'function') return value
        return (...args) => { if (['query', 'subscribe'].includes(key)) boot.reads.push({ method: key, filter: args[0], options: args[1] }); return value.apply(target, args) }
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
