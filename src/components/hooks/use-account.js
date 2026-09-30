import { createConversationSummaries } from '#services/conversation-summaries.js'
import { createContacts } from '#services/contacts.js'
import { createPrivateChats } from '#services/private-chats.js'
import { privateChatDiagnostic } from '#services/private-chat-diagnostics.js'
import { demoPeople, demoEnabled } from '#services/demo.js'
import { npubEncode } from 'libp2r2p/nip19'
import { onOnline } from 'libp2r2p/network'
import { useGlobalStore, useMemo, useStore, useTask } from '#f'
import { createSelfChat, createChat } from '#services/self-chat.js'
import { eventToProfile, selectPreferredProfile, getProfile, refreshProfile } from '#helpers/nostr/queries.js'

export function useAccount () {
  return useGlobalStore('zillion-account', () => ({
    pubkey$: null, profile$: null, messages$: [], error$: null, ready$: false, historyLoaded$: false, historyState$: 'loading',
    retry$: 0, older$: { loading: false, error: null, hasOlder: false },
    // Inner events resolved from kind-9 references, keyed by event id.
    outbox$: [], references$: {}, directory$: {}, contacts$: [], contactsState$: 'loading', conversations$: {}, summaries$: {}, signerState$: null, recovery$: 0,
    people$ () {
      return [...this.contacts$().map(contact => this.personFor(contact.pubkey)), ...demoPeople]
    },
    personFor (id) {
      if (id === 'user' || id === this.pubkey$()) return this.person$()
      const fixture = demoPeople.find(person => person.id === id)
      if (fixture) return fixture
      if (!/^[0-9a-f]{64}$/.test(id || '')) return null
      const profile = this.directory$()[id] || {}
      const contact = this.contacts$().find(contact => contact.pubkey === id)
      const npub = npubEncode(id)
      const name = contact?.petname || profile.name?.trim() || profile.display_name?.trim() || `${npub.slice(0, 12)}…`
      return { id, pubkey: id, profile, npub, nip05: profile.nip05 || '', name, shortName: name, saved: !!contact, pinned: false, unread: 0 }
    },
    person$ () {
      const profile = this.profile$()
      return { id: 'user', self: true, pubkey: this.pubkey$(), profile: profile ?? {}, name: profile?.name?.trim() || profile?.display_name?.trim() || '', shortName: profile?.name?.trim() || profile?.display_name?.trim() || '', pinned: false, unread: 0 }
    }
  }))
}

// Mounted once at the app root; retained routes only read these signals.
export function useInitAccount () {
  const account = useAccount()
  useInitPrivateChats(account)
  useInitConversationSummaries(account)
  const runtime = useMemo(() => ({ chat: null, opened: false }))
  account.openSelfConversation = () => { runtime.opened = true; return runtime.chat ? runtime.chat.start(account.summaries$()[account.pubkey$()]) : account.recover() }
  account.send = (content, replyTo, attachment) => {
    if (!runtime.chat) throw new Error('Account unavailable')
    return runtime.chat.send(content, replyTo, attachment)
  }
  account.retryMessage = id => runtime.chat?.retry(id)
  account.deleteMessage = id => runtime.chat?.deleteMessage(id) ?? Promise.resolve(false)
  account.resolveReference = reference => runtime.chat?.resolveReference(reference) ?? null
  account.createMediaReader = options => {
    if (!runtime.chat) throw new Error('Account unavailable')
    return runtime.chat.createMediaReader(options)
  }
  account.readFiles = options => runtime.chat?.readFiles(options) ?? Promise.resolve([])
  account.loadOlder = () => runtime.chat?.loadOlder() ?? Promise.resolve(false)
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
      const filter = { kinds: [0], authors: [pubkey], limit: 1 }
      profiles = eventStore.subscribe(filter, { initial: true })
      const stream = profiles
      ;(async () => { for await (const item of stream) { if (!current()) return; if (item.type === 'event') update(item.event) } })().catch(() => {})
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
              pubkey, eventStore, signer: window.nostr, transport: demoEnabled ? undefined : { enqueue: options => account.delivery().enqueue(options), cancel: id => account.delivery().cancel(id), retry: id => account.delivery().retry(id) }, onMessages: account.messages$, onError: report,
              onReference: (id, event) => { if (!closed) account.references$({ ...account.references$(), [id]: event }) },
              onDelete: ids => {
                if (closed) return
                const removed = new Set(ids)
                account.messages$(list => list.filter(message => !removed.has(message.id)))
              },
              onInitialLoad: () => { if (!closed) account.historyLoaded$(true) },
              onOlderState: account.older$,
              onHistoryState: state => { if (!closed) account.historyState$(state) }
            })
          }
          runtime.chat.applyOutbox(account.outbox$())
          account.ready$(true)
          loadProfile(pubkey, eventStore)
          return runtime.opened ? await runtime.chat.start(account.summaries$()[pubkey]) : true
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
  useTask(({ track }) => { const entries = track(() => account.outbox$()); if (!demoEnabled) runtime.chat?.applyOutbox(entries) })
  // Retry the read session without tearing down the account or its outbox.
  useTask(({ track }) => { track(() => account.retry$()); account.recover() })
}

function useInitConversationSummaries (account) {
  const runtime = useMemo(() => ({ summaries: null, recovery: -1 }))
  useTask(({ track, cleanup }) => {
    const owner = track(() => account.pubkey$())
    if (!owner) return
    const summaries = createConversationSummaries({
      pubkey: owner, signer: window.nostr, eventStore: window.napp.eventStore,
      onChange: (peer, summary) => account.summaries$(previous => {
        const next = { ...previous }
        if (summary) next[peer] = summary
        else delete next[peer]
        return next
      }),
      onError: error => console.warn('Could not load conversation preview', error)
    })
    runtime.summaries = summaries
    runtime.recovery = -1
    cleanup(() => { summaries.close(); runtime.summaries = null; account.summaries$({}) })
  })
  useTask(({ track }) => {
    const [owner, ready, contacts, recovery] = track(() => [account.pubkey$(), account.ready$(), account.contacts$(), account.recovery$()])
    if (!owner || !ready || !runtime.summaries) return
    if (runtime.recovery !== recovery) {
      if (runtime.recovery >= 0) runtime.summaries.recover().catch(() => {})
      runtime.recovery = recovery
    }
    runtime.summaries.setPeers(contacts.map(contact => contact.pubkey)).catch(() => {})
  })
}

function useInitPrivateChats (account) {
  const runtime = useMemo(() => ({ chats: new Map(), transport: null, contacts: null, outbox: [], profiles: new Map(), profileActive: 0, profileQueue: [], version: 0 }))
  const patch = (peer, values) => account.conversations$(previous => ({ ...previous, [peer]: { ...previous[peer], ...values } }))
  account.delivery = () => { if (!runtime.transport) throw new Error('Account unavailable'); return runtime.transport }
  account.openConversation = async peer => {
    const owner = account.pubkey$()
    if (!owner || !/^[0-9a-f]{64}$/.test(peer || '') || peer === owner) return
    account.loadPerson(peer)
    if (!runtime.chats.has(peer)) {
      const chat = createChat({
        pubkey: owner, peer, eventStore: window.napp.eventStore, signer: window.nostr, transport: runtime.transport,
        onMessages: messages => patch(peer, { messages }),
        onError: error => patch(peer, { error: error.message }),
        onReference: (id, event) => patch(peer, { references: { ...account.conversations$()[peer]?.references, [id]: event } }),
        onHistoryState: historyState => patch(peer, { historyState }),
        onOlderState: older => patch(peer, { older }),
        onInitialLoad: () => patch(peer, { historyLoaded: true })
      })
      runtime.chats.set(peer, chat)
      chat.applyOutbox(runtime.outbox)
    }
    patch(peer, { error: null })
    await runtime.chats.get(peer).start(account.summaries$()[peer])
  }
  account.chatFor = peer => runtime.chats.get(peer)
  account.recoverContacts = () => runtime.contacts?.start() ?? Promise.resolve(false)
  account.setContact = async (peer, included) => {
    if (demoPeople.some(person => person.pubkey === peer)) return false
    if (!runtime.contacts) throw new Error('Account unavailable')
    return runtime.contacts.set(peer, included)
  }
  account.loadPerson = peer => {
    if (!/^[0-9a-f]{64}$/.test(peer || '') || runtime.profiles.has(peer)) return runtime.profiles.get(peer)
    const version = runtime.version
    const update = profile => {
      if (profile && version === runtime.version) account.directory$(previous => ({ ...previous, [peer]: selectPreferredProfile(previous[peer], profile) }))
    }
    const work = (async () => {
      if (runtime.profileActive >= 4) await new Promise(resolve => runtime.profileQueue.push(resolve))
      else runtime.profileActive++
      try {
        if (version !== runtime.version) return
        update(await getProfile(peer))
        if (version === runtime.version) update(await refreshProfile(peer))
      } finally { const next = runtime.profileQueue.shift(); if (next) next(); else runtime.profileActive-- }
    })().catch(() => {})
    runtime.profiles.set(peer, work)
    return work
  }
  useTask(({ track, cleanup }) => {
    const owner = track(() => account.pubkey$())
    if (!owner || demoEnabled) return
    let closed = false
    account.contactsState$('loading')
    runtime.transport = createPrivateChats({
      owner, signer: window.nostr, eventStore: window.napp.eventStore,
      onOutbox: entries => {
        if (closed) return
        runtime.outbox = entries
        account.outbox$(entries)
        for (const chat of runtime.chats.values()) chat.applyOutbox(entries)
      },
      onError: error => { if (!closed) console.warn(`Private chat operation failed ${JSON.stringify(privateChatDiagnostic(error, owner))}`, error) }
    })
    runtime.contacts = createContacts({
      owner, signer: window.nostr, eventStore: window.napp.eventStore,
      onChange: contacts => {
        if (closed) return
        account.contacts$(contacts)
        runtime.transport.setPeers(contacts.map(contact => contact.pubkey)).catch(() => {})
        // Bounded profile work; shared promises prevent duplicate point lookups.
        let index = 0
        const load = async () => { while (index < contacts.length) { if (closed) break; await account.loadPerson(contacts[index++].pubkey) } }
        for (let worker = 0; worker < 4; worker++) load()
      },
      onState: state => { if (!closed) account.contactsState$(state) },
      onError: error => { if (!closed) console.warn('Could not load contacts', error) }
    })
    let availableApplied = false
    let wasAvailable = false
    const stateChanged = async (state, { resume = false } = {}) => {
      if (closed) return
      account.signerState$(state)
      const available = state.connection === 'connected' && state.access === 'allowed' && !state.isLocked && state.isReadOnly === false
      const changed = available !== availableApplied
      if (!changed && !resume) return
      availableApplied = available
      // Begin transport recovery and local reads independently. setState can
      // wait for encrypted queues, channels and remote recovery work.
      const delivery = runtime.transport.setState(state).catch(error => { if (!closed) console.warn('Could not resume message delivery', error) })
      if (!available || !changed) return delivery
      const reads = [runtime.contacts.start()]
      account.recovery$(value => value + 1)
      // Routes start history lazily. Recovery reopens only visited histories,
      // independently of the lightweight summaries maintained for the list.
      if (wasAvailable || account.historyState$() === 'unavailable') reads.push(account.recover?.())
      if (wasAvailable) for (const chat of runtime.chats.values()) reads.push(chat.start())
      wasAvailable = true
      await Promise.all([delivery, ...reads])
    }
    const stopState = window.napp.onSignerStateChanged(stateChanged)
    stopState.ready?.catch(error => { if (!closed) console.warn('Signer state unavailable', error) })
    const stopOnline = onOnline(async () => {
      if (!closed) await stateChanged(await window.napp.getSignerState(), { resume: true })
    })
    cleanup(() => {
      closed = true
      stopState(); stopOnline()
      runtime.contacts?.close(); runtime.contacts = null
      runtime.transport?.close().catch(() => {}); runtime.transport = null
      for (const chat of runtime.chats.values()) chat.close()
      runtime.version++
      runtime.chats.clear(); runtime.profiles.clear(); runtime.outbox = []
      account.contacts$([]); account.contactsState$('loading')
    })
  })
}

export function useConversation (id$, { open = false } = {}) {
  const account = useAccount()
  const view = useStore(() => ({
    pubkey$: account.pubkey$,
    peer$ () { return id$() === 'user' ? account.pubkey$() : id$() },
    self$ () { return this.peer$() === account.pubkey$() },
    data$ () { return account.conversations$()[this.peer$()] || {} },
    messages$ () { return this.self$() ? account.messages$() : this.data$().messages || [] },
    references$ () { return this.self$() ? account.references$() : this.data$().references || {} },
    historyState$ () { return this.self$() ? account.historyState$() : this.data$().historyState || 'loading' },
    historyLoaded$ () { return this.self$() ? account.historyLoaded$() : !!this.data$().historyLoaded },
    error$ () { return this.self$() ? account.error$() : this.data$().error },
    ready$ () { return account.ready$() },
    older$ () { return this.self$() ? account.older$() : this.data$().older || { loading: false, hasOlder: false } },
    send (...args) {
      if (this.self$()) return account.send(...args)
      if (account.contactsState$() !== 'loaded' || !account.personFor(this.peer$())?.saved) throw new Error('CHAT_UNAVAILABLE')
      return account.chatFor(this.peer$()).send(...args)
    },
    retryMessage (id) { return this.self$() ? account.retryMessage(id) : account.chatFor(this.peer$())?.retry(id) },
    deleteMessage (...args) { return this.self$() ? account.deleteMessage(...args) : account.chatFor(this.peer$())?.deleteMessage(...args) },
    resolveReference (reference) { return this.self$() ? account.resolveReference(reference) : account.chatFor(this.peer$())?.resolveReference(reference) },
    createMediaReader (options) { return this.self$() ? account.createMediaReader(options) : account.chatFor(this.peer$()).createMediaReader(options) },
    readFiles (options) { return account.readFiles(options) },
    loadOlder () { return this.self$() ? account.loadOlder() : account.chatFor(this.peer$())?.loadOlder() },
    recover () { return this.self$() ? account.recover() : account.openConversation(this.peer$()) },
    retry$ () { this.recover() }
  }))
  useTask(({ track }) => {
    const [peer, owner, ready, initialized] = track(() => [view.peer$(), account.pubkey$(), account.signerState$(), account.ready$()])
    if (open && peer && owner && initialized && ((ready?.connection === 'connected' && !ready.isLocked) || demoEnabled) && !demoPeople.some(person => person.id === peer)) {
      const work = peer === owner ? account.openSelfConversation() : account.openConversation(peer)
      work?.catch(() => {})
    }
  })
  return view
}
