import { f, useStore } from '#f'
import '#shared/avatar.js'
import mediaCache from '#services/media-cache.js'
import { getProfile } from '#helpers/nostr/queries.js'

// Imported only by the browser fixture entry, never by the published app.
const fixture = window.__zillionTest = {
  token: crypto.randomUUID(),
  injectedBeforeEntry: Boolean(window.napp?.eventStore && window.nostr?.peekPublicKey),
  identity: window.nostr.peekPublicKey(),
  locale: window.napp.getLocale(),
  mediaCache,
  getProfile
}

f('z-browser-fixture', ({ h }) => {
  const view = useStore(() => ({ pk$: null }))
  fixture.view = view
  return h`<main><div style="width: 64px; height: 64px;"><a-avatar props=${{ pk$: view.pk$ }} /></div></main>`
})
