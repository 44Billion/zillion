import '#components/app.js'
import { nfileEncode } from 'libp2r2p/nip19'
import { createFileMetadata } from 'libp2r2p/nip94'
import { rememberAttachmentPreview } from '#services/attachment-previews.js'
import { f, useStore, useClosestStore, useMemo } from '#f'
import { useAccount } from '#hooks/use-account.js'

// Test-only access to app state; launcher identity, storage and permissions stay real.
f('z-self-chat-fixture', ({ h }) => {
  window.selfChatAccount = useAccount()
  const view = useStore({ galleryFixture$: false })
  window.selfChatFixture = view
  return h`<z-app />${view.galleryFixture$() ? h`<z-gallery-ui-fixture />` : null}`
})

// Controlled component states complement the real vault recovery scenarios.
// This does not replace any launcher provider or the running account service.
f('z-gallery-ui-fixture', ({ h }) => {
  useClosestStore('z-route-page', () => ({ isActive$: true }), { shouldCache: false })
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
