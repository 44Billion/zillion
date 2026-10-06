import { installPrivateChatFixture } from '../private-chat-fixture.js'
import '#components/app.js'
import './route-driver.js'
import { f, useStore } from '#f'
import { useAccount } from '#hooks/use-account.js'
import { RelayPool, relayPool } from 'libp2r2p/relay'

installPrivateChatFixture()
const originalGetEvents = relayPool.getEvents.bind(relayPool)
const state = { peer: null, profiles: [], requests: [], frames: [], releaseAt: 0, holdPeers: [], held: [] }
const pool = new RelayPool({
  WebSocket: class ProfileRelaySocket {
    constructor (url) {
      this.url = url; this.readyState = 0
      queueMicrotask(() => { this.readyState = 1; this.onopen?.() })
    }

    send (raw) {
      const frame = JSON.parse(raw)
      state.frames.push({ frame, relay: this.url, at: Date.now() })
      if (frame[0] !== 'REQ') return
      const [, id, filter] = frame
      const pubkey = filter.authors?.[0]
      state.requests.push({ pubkey, relay: this.url, at: Date.now() })
      queueMicrotask(() => {
        const send = value => this.onmessage?.({ data: JSON.stringify(value) })
        const reply = () => {
          if (this.readyState !== 1) return
          for (const event of state.profiles) if (event.pubkey === pubkey) send(['EVENT', id, event])
          send(['EOSE', id])
        }
        if (state.holdPeers.includes(pubkey) || globalThis.__profileRecoveryHoldAll) { state.held.push(reply); return }
        if (pubkey === state.peer && Date.now() < state.releaseAt) {
          send(['CLOSED', id, 'rate-limited: profile fixture', { retry_after: Math.ceil((state.releaseAt - Date.now()) / 1000) }])
          return
        }
        reply()
      })
    }

    close () { this.readyState = 3; queueMicrotask(() => this.onclose?.({ code: 1000, reason: '', wasClean: true })) }
  }
})
relayPool.getEvents = (filter, relays, options) => filter.kinds?.includes(0)
  ? pool.getEvents(filter, relays, options)
  : originalGetEvents(filter, relays, options)
f('z-profile-recovery-avatars', ({ h }) => h`<div><a-avatar props=${{ pk: state.peer }} /><a-avatar props=${{ pk: state.peer }} /></div>`)
f('z-profile-recovery-avatar', ({ h }) => {
  const avatar = useStore(() => ({ pk$: state.avatarOptions.pk, profile$: state.avatarOptions.profile ?? {} }))
  window.profileRecovery.avatar = avatar
  return h`<div style='width:44px;height:44px'><a-avatar props=${{ pk$: avatar.pk$, profile$: avatar.profile$, localOnly: true }} /></div>`
})
f('z-profile-recovery-fixture', ({ h }) => {
  window.profileRecovery = {
    state,
    account: useAccount(),
    mountAvatars: host => { host.innerHTML = '<z-profile-recovery-avatars></z-profile-recovery-avatars>' },
    mountAvatar: (host, options) => { state.avatarOptions = options; host.innerHTML = '<z-profile-recovery-avatar></z-profile-recovery-avatar>' }
  }
  return h`<z-app />`
})
