import { useGlobalStore, useMemo, useTask } from '#f'
import { createSelfChat } from '#services/self-chat.js'
import { eventToProfile, selectPreferredProfile } from '#helpers/nostr/queries.js'

export function useAccount () {
  return useGlobalStore('zillion-account', () => ({
    pubkey$: null, profile$: null, messages$: [], error$: null, ready$: false, historyLoaded$: false,
    retry$: 0,
    person$ () {
      const profile = this.profile$()
      return { id: 'user', self: true, pubkey: this.pubkey$(), profile: profile ?? {}, name: profile?.name ?? '', shortName: profile?.name ?? '', pinned: false, unread: 0 }
    }
  }))
}

// Mounted once at the app root; retained routes only read these signals.
export function useInitAccount () {
  const account = useAccount()
  const runtime = useMemo(() => ({ chat: null }))
  account.send = (content, replyTo, attachment) => {
    if (!runtime.chat) throw new Error('Account unavailable')
    return runtime.chat.send(content, replyTo, attachment)
  }
  account.retryMessage = id => runtime.chat?.retry(id)
  useTask(({ track, cleanup }) => {
    track(() => account.retry$())
    let closed = false
    let profiles
    let chat
    account.error$(null)
    account.historyLoaded$(false)
    cleanup(() => {
      closed = true
      chat?.close()
      profiles?.return().catch(() => {})
      if (runtime.chat === chat) runtime.chat = null
    })
    const report = error => { if (!closed) account.error$(error.message || String(error)) }
    const updateProfile = event => {
      if (!closed && event?.pubkey === account.pubkey$()) account.profile$(previous => selectPreferredProfile(previous, eventToProfile(event)))
    }
    const start = async () => {
      const pubkey = await window.nostr.peekPublicKey()
      if (closed) return
      if (!/^[0-9a-f]{64}$/.test(pubkey || '')) { account.ready$(true); account.historyLoaded$(true); return }
      account.pubkey$(pubkey)
      const eventStore = window.napp.eventStore
      if (!(await eventStore.supports()).includes('subscribe:initial')) throw new Error('Launcher update required for initial event-store subscriptions')
      if (closed) return
      chat = createSelfChat({ pubkey, eventStore, signer: window.nostr, onMessages: account.messages$, onError: report, onInitialLoad: () => { if (!closed) account.historyLoaded$(true) } })
      runtime.chat = chat
      account.ready$(true)
      chat.start()
      const filter = { kinds: [0], authors: [pubkey] }
      profiles = eventStore.subscribe(filter, { initial: true })
      const live = (async () => { for await (const { result } of profiles) updateProfile(result) })()
      live.catch(report)
      const { results } = await eventStore.query({ ...filter, limit: 1 })
      for (const event of results) updateProfile(event)
    }
    start().catch(report)
  })
}
