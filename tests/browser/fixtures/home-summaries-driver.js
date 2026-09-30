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

// Real locally stored IRFS fixtures for speculative preview preparation.
boot.seedPreviewMedia = async ({ peer, at, name, mime = 'image/png', bytes, index = 0, stored = 'all', thumb = false, hash = false, dimensions = false }) => {
  const [{ prepareIrfsFile }, { attachmentPlaceholder }, { rgbaToThumbHash }, { bytesToBase64 }] = await Promise.all([
    import('libp2r2p/irfs'), import('#helpers/attachment-placeholder.js'), import('thumbhash'), import('libp2r2p/base64')
  ])
  const owner = await window.nostr.peekPublicKey()
  const canvas = document.createElement('canvas'); canvas.width = 200 + index * 10; canvas.height = 100
  const context = canvas.getContext('2d'); context.fillStyle = `rgb(${20 + index * 20}, 120, 180)`; context.fillRect(0, 0, canvas.width, canvas.height)
  const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  const original = await prepareIrfsFile(bytes ? new Uint8Array(bytes) : png)
  const thumbnail = thumb ? await prepareIrfsFile(png) : null
  const savedChunks = []
  const save = async event => {
    const result = await window.napp.eventStore.addPersonalCopy(event, { context: `dm:${peer}` })
    if (!result?.result?.ok) throw new Error('FIXTURE_STORAGE_FAILED')
  }
  try {
    let chunkIndex = 0
    for await (const chunk of original.chunks({ created_at: at })) {
      savedChunks.push(chunk.tags.find(tag => tag[0] === 'd')[1])
      if (stored === 'all' || (stored === 'partial' && chunkIndex++ === 0)) await save(chunk)
    }
    if (thumbnail) for await (const chunk of thumbnail.chunks({ created_at: at })) await save(chunk)
    const metadata = {
      root: original.root, size: original.size, mime, service: 'irfs', url: `https://nostr.alt/${nfileEncode({ root: original.root, mime, filename: name })}`,
      ...(dimensions ? { width: canvas.width, height: canvas.height } : {}),
      ...(thumbnail ? { thumbnail: { root: thumbnail.root, size: thumbnail.size, url: `https://nostr.alt/${nfileEncode({ root: thumbnail.root, mime: 'image/png' })}` } } : {}),
      ...(hash ? { thumbhash: bytesToBase64(rgbaToThumbHash(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]))) } : {})
    }
    const file = { ...createFileMetadata({ ...metadata, created_at: at }), pubkey: owner }
    await save(file); file.id = getEventHash(file)
    const message = { kind: 9, pubkey: owner, created_at: at, tags: [['q', file.id, '', owner]], content: chatReferenceUri(file) }
    await save(message)
    return { ...metadata, messageId: getEventHash(message), id: file.id, chunkIds: savedChunks, placeholder: !!attachmentPlaceholder(metadata) }
  } finally { original.close(); thumbnail?.close() }
}

boot.localRequests = []
const fetchOriginal = window.fetch
window.fetch = (...args) => {
  const url = String(args[0]?.url || args[0])
  if (url.startsWith('https://nostr.alt/')) boot.localRequests.push({ url, method: args[1]?.method || 'GET' })
  return fetchOriginal(...args)
}
boot.previewInfo = async file => {
  const { attachmentPreviewDimensions } = await import('#services/attachment-previews.js')
  return attachmentPreviewDimensions(file)
}
boot.watchGeometry = name => {
  boot.geometry = []
  const measure = () => {
    const attachment = [...document.querySelectorAll('.route-page[data-active=true] .chat-attachment')].find(node => node.textContent.includes(name))
    const frame = attachment?.querySelector('.attachment-frame')
    if (frame) { const rect = frame.getBoundingClientRect(); boot.geometry.push({ width: rect.width, height: rect.height }) }
  }
  const observer = new MutationObserver(measure)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true })
  boot.stopGeometry = () => { measure(); observer.disconnect() }
}
