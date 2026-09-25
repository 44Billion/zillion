import { installPrivateChatFixture } from './private-chat-fixture.js'
import '#components/app.js'
import { nfileEncode } from 'libp2r2p/nip19'
import { createFileMetadata } from 'libp2r2p/nip94'
import { rememberAttachmentPreview } from '#services/attachment-previews.js'
import { f, useStore, useClosestStore, useMemo } from '#f'
import { useAccount } from '#hooks/use-account.js'

// Measurements use the real event-store bridge and vault. The serial baseline
// measures one full query + sequential decryption (without its old duplicate replay).
import { createSelfChat } from '#services/self-chat.js'
import { decryptPersonalCopy } from '#services/chat-references.js'

// Test-only access to app state; launcher identity, storage and permissions stay real.
f('z-self-chat-fixture', ({ h }) => {
  window.selfChatAccount = useAccount()
  window.installPrivateChatFixture = installPrivateChatFixture
  const view = useStore({ galleryFixture$: false })
  window.selfChatFixture = view
  return h`<z-app />${view.galleryFixture$() ? h`<z-gallery-ui-fixture />` : null}`
})

// Controlled component states complement the real vault recovery scenarios.
// This does not replace any launcher provider or the running account service.
f('z-gallery-ui-fixture', ({ h }) => {
  useClosestStore('z-route-page', () => ({ isActive$: true }), { shouldCache: false })
  useClosestStore('<f-route>', () => ({ route$: { params: { contactId: 'user' } } }), { shouldCache: false })
  const runtime = useMemo(() => ({ work: null, files: [] }))
  const view = useStore({
    messages$: [], references$: {}, historyState$: 'unavailable', canAttach$: true, canSend$: false, calls$: 0,
    recover () {
      if (runtime.work) return runtime.work.promise
      this.calls$(value => value + 1)
      this.historyState$('loading')
      runtime.work = Promise.withResolvers()
      return runtime.work.promise
    },
    async seedGallery (count) {
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'green'; ctx.fillRect(0, 0, 8, 8)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      runtime.files = Array.from({ length: count }, (_, index) => {
        const root = (index + 1).toString(16).padStart(64, '0')
        const mime = 'image/png'; const filename = `gallery-${index}.png`
        const file = { root, mime, filename, width: 8, height: 8, size: blob.size, service: 'irfs', url: `https://nostr.alt/${nfileEncode({ root, mime, filename })}?localOnly=1` }
        rememberAttachmentPreview(file, { blob, width: 8, height: 8 })
        return { ...createFileMetadata(file), id: root, status: 'saved' }
      })
      // Re-run the composer catalog task so the seeded files are visible even
      // when the fixture starts outside the attachment flow.
      this.historyState$('loading')
      this.historyState$('loaded')
    },
    seedConversationFile () {
      const root = 'f'.repeat(64)
      this.references$({
        [root]: {
          ...createFileMetadata({ root, mime: 'image/png', width: 1, height: 1, url: `https://nostr.alt/${nfileEncode({ root, mime: 'image/png', filename: 'conversation-only.png' })}?localOnly=1` }),
          id: root
        }
      })
    },
    settle (state) { this.historyState$(state); runtime.work?.resolve(); runtime.work = null }
  })
  window.galleryUI = view
  const readFiles = async () => {
    // The controlled fixture drives loading/failure through historyState$, so
    // the catalog read itself always resolves (possibly empty).
    return runtime.files
  }
  return h`<div class="gallery-fixture"><z-chat-composer props=${{
    messages$: view.messages$, references$: view.references$, historyState$: view.historyState$, canAttach$: view.canAttach$,
    canSend$: view.canSend$, recover: view.recover, readFiles
  }} /></div>`
})
window.measureChatHistory = async () => {
  const pubkey = await window.nostr.peekPublicKey()
  const context = await window.nostr.obfuscate(`dm:${pubkey}`, '1006', '')
  const metrics = () => ({ queries: 0, queryMs: 0, deliveryMs: 0, decryptMs: 0, decryptions: 0, maxConcurrent: 0, updates: 0, totalMs: 0 })
  async function measure (serial) {
    const measured = metrics()
    let concurrent = 0
    const signer = {
      ...window.nostr, nip44v3: {
        ...window.nostr.nip44v3, async decrypt (...args) {
          const start = performance.now(); measured.decryptions++; concurrent++; measured.maxConcurrent = Math.max(measured.maxConcurrent, concurrent)
          try { return await window.nostr.nip44v3.decrypt(...args) } finally { measured.decryptMs += performance.now() - start; concurrent-- }
        }
      }
    }
    const store = {
      ...window.napp.eventStore,
      async query (...args) { const start = performance.now(); measured.queries++; try { return await window.napp.eventStore.query(...args) } finally { measured.queryMs += performance.now() - start } },
      subscribe (...args) {
        const stream = window.napp.eventStore.subscribe(...args)
        const start = performance.now()
        return { [Symbol.asyncIterator] () { return this }, async next () { const item = await stream.next(); if (item.value?.type === 'eose') measured.deliveryMs = performance.now() - start; return item }, return: () => stream.return() }
      }
    }
    const start = performance.now()
    if (serial) {
      const { results } = await store.query({ kinds: [1006], '#k': ['9'], '#c': [context], '#v': ['0', '1'], authors: [pubkey] })
      for (const wrapper of results) await decryptPersonalCopy(wrapper, { pubkey, signer, encodedContext: context })
    } else {
      const chat = createSelfChat({ pubkey, eventStore: store, signer, onMessages: () => measured.updates++, onError: error => { throw error } })
      try { await chat.start() } finally { chat.close() }
    }
    measured.totalMs = performance.now() - start
    return measured
  }
  return { paged: await measure(false), serial: await measure(true) }
}
