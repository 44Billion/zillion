import { f, useStore } from '#f'
import '#shared/avatar.js'
import mediaCache from '#services/media-cache.js'
import avatarCache from '#services/avatar-cache.js'
import { getProfile } from '#helpers/nostr/queries.js'
import { useAccount, useInitAccount } from '#hooks/use-account.js'

// Imported only by the browser fixture entry, never by the published app.
const fixture = window.__zillionTest = {
  token: crypto.randomUUID(),
  injectedBeforeEntry: Boolean(window.napp?.eventStore && window.nostr?.peekPublicKey),
  identity: window.nostr.peekPublicKey(),
  locale: window.napp.getLocale(),
  mediaCache,
  avatarCache,
  getProfile
}

f('z-browser-fixture', ({ h }) => {
  useInitAccount()
  fixture.account = useAccount()
  const view = useStore(() => ({ pk$: null }))
  fixture.view = view
  const pk = view.pk$()
  // Match keyed contact rows: each identity owns its mounted avatar.
  return h`<main><div style="width: 64px; height: 64px;">${h({ key: pk ?? 'empty' })`<a-avatar props=${{ pk }} />`}</div></main>`
})
