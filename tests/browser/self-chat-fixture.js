import '#components/app.js'
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
  const runtime = useMemo(() => ({ work: null }))
  const view = useStore({
    messages$: [], historyState$: 'unavailable', canAttach$: true, canSend$: false, calls$: 0,
    recover () {
      if (runtime.work) return runtime.work.promise
      this.calls$(value => value + 1)
      this.historyState$('loading')
      runtime.work = Promise.withResolvers()
      return runtime.work.promise
    },
    settle (state) { this.historyState$(state); runtime.work?.resolve(); runtime.work = null }
  })
  window.galleryUI = view
  return h`<div class="gallery-fixture"><z-chat-composer props=${{ messages$: view.messages$, historyState$: view.historyState$, canAttach$: view.canAttach$, canSend$: view.canSend$, recover: view.recover }} /></div>`
})
