import { useGlobalStore, useMemo, useTask } from '#f'
import { createSelfChat } from '#services/self-chat.js'
import { eventToProfile, selectPreferredProfile } from '#helpers/nostr/queries.js'

export function useAccount () {
  return useGlobalStore('zillion-account', () => ({
    pubkey$: null, profile$: null, messages$: [], error$: null, ready$: false, historyLoaded$: false, historyState$: 'loading',
    retry$: 0,
    // Inner events resolved from kind-9 references, keyed by event id.
    references$: {},
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
  account.deleteMessage = id => runtime.chat?.deleteMessage(id) ?? Promise.resolve(false)
  account.resolveReference = reference => runtime.chat?.resolveReference(reference) ?? null
  account.readFiles = options => runtime.chat?.readFiles(options) ?? Promise.resolve([])
  account.recover = () => runtime.recover?.() ?? Promise.resolve(false)
  useTask(({ cleanup }) => {
    let closed = false
    let profiles
    let identity = null
    let recovery
    let profileVersion = 0
    const report = error => { if (!closed) account.error$(error.message || String(error)) }
    const loadProfile = (pubkey, eventStore) => {
      const version = ++profileVersion
      profiles?.return().catch(() => {})
      const current = () => !closed && profileVersion === version
      const update = event => {
        if (current() && event?.pubkey === pubkey) account.profile$(previous => selectPreferredProfile(previous, eventToProfile(event)))
      }
      const filter = { kinds: [0], authors: [pubkey] }
      profiles = eventStore.subscribe(filter, { initial: true })
      const stream = profiles
      ;(async () => { for await (const { result } of stream) { if (!current()) return; update(result) } })().catch(() => {})
      eventStore.query({ ...filter, limit: 1 }).then(({ results }) => { for (const event of results) update(event) }).catch(() => {})
    }
    runtime.recover = () => {
      if (closed) return Promise.resolve(false)
      if (recovery) return recovery
      account.error$(null)
      account.historyState$('loading')
      recovery = (async () => {
        try {
          const pubkey = await window.nostr.peekPublicKey()
          if (closed) return false
          if (!/^[0-9a-f]{64}$/.test(pubkey || '')) throw new Error('Account unavailable')
          if (identity !== pubkey) {
            runtime.chat?.close(); runtime.chat = null
            profileVersion++; profiles?.return().catch(() => {}); profiles = null
            identity = pubkey
            account.messages$([]); account.profile$(null); account.historyLoaded$(false); account.references$({})
          }
          account.pubkey$(pubkey)
          const eventStore = window.napp.eventStore
          if (!(await eventStore.supports()).includes('subscribe:initial')) throw new Error('Launcher update required for initial event-store subscriptions')
          if (closed) return false
          if (!runtime.chat) {
            runtime.chat = createSelfChat({
              pubkey, eventStore, signer: window.nostr, onMessages: account.messages$, onError: report,
              onReference: (id, event) => { if (!closed) account.references$({ ...account.references$(), [id]: event }) },
              onDelete: ids => {
                if (closed) return
                const removed = new Set(ids)
                account.messages$(list => list.filter(message => !removed.has(message.id)))
              },
              onInitialLoad: () => { if (!closed) account.historyLoaded$(true) },
              onHistoryState: state => { if (!closed) account.historyState$(state) }
            })
          }
          account.ready$(true)
          loadProfile(pubkey, eventStore)
          return await runtime.chat.start()
        } catch (error) {
          if (!closed) { account.historyState$('unavailable'); account.ready$(true); report(error) }
          return false
        }
      })().finally(() => { recovery = null })
      return recovery
    }
    cleanup(() => {
      closed = true
      runtime.chat?.close(); runtime.chat = null
      profiles?.return().catch(() => {})
      runtime.recover = null
    })
  })
  // Retry the read session without tearing down the account or its outbox.
  useTask(({ track }) => { track(() => account.retry$()); account.recover() })
}
