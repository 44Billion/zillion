import { createRelayRead } from './relay-read.js'
import { isOnline, onOnline } from 'libp2r2p/network'
import { CONTACT_LIST, DELETION, FOLLOW_SET, PERSONAL_COPY } from 'libp2r2p/kind'
import { isValidEvent } from 'libp2r2p/event'
import { decryptPersonalCopy } from './chat-references.js'

export const CONTACTS_DTAG = '+zillion:contacts'
export const CONTACT_LIST_KIND = CONTACT_LIST
export const LEGACY_CONTACT_LIST_KIND = FOLLOW_SET

const CONTACTS_ONLINE_TIMEOUT_MS = 6000
const CONTACT_LIST_LOCK_PREFIX = 'zillion:contacts:'
// Exponential backoff capped at 5 minutes.
const CONTACTS_REFRESH_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 5 * 60 * 1000]
const hex = value => /^[0-9a-f]{64}$/.test(value || '')
const preferred = (a, b) => !a || b.created_at > a.created_at || (b.created_at === a.created_at && b.id < a.id) ? b : a
// NostrDB decorates owner-authored tags with reserved "~..." values. They are
// never metadata: a decorated kind-3 tag may occupy the relay-hint slot, and
// the store strips decorations on merge, so copying one into a new tag shifts
// every later value.
const isDecoration = value => typeof value === 'string' && value.startsWith('~')
const tagValue = (tag, index) => typeof tag?.[index] === 'string' && !isDecoration(tag[index]) ? tag[index] : ''
// The override label merges every state letter in one slot: 'r' removes the
// contact (and wins over 'p'), 'p' pins it, and absent/empty/unknown values
// mean an unpinned contact. Letter order never matters; unknown letters are
// ignored so newer interoperable writers can add labels without breaking us.
function entryState (tag) {
  const label = typeof tag?.[4] === 'string' && !isDecoration(tag[4]) ? tag[4] : ''
  const removed = label.includes('r')
  return { relayHint: tagValue(tag, 2), petname: tagValue(tag, 3), removed, pinned: !removed && label.includes('p') }
}

const legacyAddress = owner => `${LEGACY_CONTACT_LIST_KIND}:${owner}:${CONTACTS_DTAG}`
const isInnerEvent = (event, owner) => event?.pubkey === owner &&
  Number.isInteger(event.kind) &&
  Number.isInteger(event.created_at) &&
  Array.isArray(event.tags) &&
  typeof event.content === 'string' &&
  typeof event.id === 'string'
const isContactList = (event, owner) => isInnerEvent(event, owner) && event.kind === CONTACT_LIST
const isLegacyContactList = (event, owner) => event?.kind === LEGACY_CONTACT_LIST_KIND &&
  isInnerEvent(event, owner) &&
  event.tags.some(tag => tag[0] === 'd' && tag[1] === CONTACTS_DTAG)

function sanitizeLegacyTags (tags) {
  const sanitized = []
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (!Array.isArray(tag) || typeof tag[0] !== 'string') continue
    const [name, value] = tag
    if (name === 'd' || name === '~' || name === 'z' || name === 'zz') continue
    if (name === 'p') {
      if (!hex(value)) continue
      sanitized.push(['pp', value, tagValue(tag, 2), tagValue(tag, 3), tagValue(tag, 4)])
      continue
    }
    sanitized.push(tag.filter(field => !isDecoration(field)))
  }
  return sanitized
}

// TODO(2027-04-23): remove the legacy kind-30000 contact-list migration.
export function migrateLegacyContactList (legacy, now = Date.now()) {
  return {
    kind: CONTACT_LIST_KIND,
    created_at: Math.max(Math.floor(now / 1000), Number(legacy?.created_at) || 0),
    tags: sanitizeLegacyTags(legacy?.tags),
    content: typeof legacy?.content === 'string' ? legacy.content : ''
  }
}

export function contactMembership (lists, owner) {
  const contacts = new Map()
  for (const event of lists.slice(0, 2)) {
    if (event?.pubkey !== owner) continue
    for (const tag of event.tags) if (tag[0] === 'p' && hex(tag[1]) && tag[1] !== owner) contacts.set(tag[1], { pubkey: tag[1], relayHint: tagValue(tag, 2), petname: tagValue(tag, 3), pinned: false })
  }
  const overrides = lists[2]
  if (overrides?.pubkey === owner) {
    for (const tag of overrides.tags) {
      if (tag[0] !== 'pp' || !hex(tag[1]) || tag[1] === owner) continue
      const { relayHint, petname, removed, pinned } = entryState(tag)
      if (removed) contacts.delete(tag[1])
      else contacts.set(tag[1], { pubkey: tag[1], relayHint, petname, pinned })
    }
  }
  return [...contacts.values()]
}

// Self membership is implicit. Only its private pin preference is persisted;
// it must never enter the peer list used by profile reads or private channels.
export function contactSelfPinned (lists, owner) {
  const overrides = lists[2]
  if (overrides?.pubkey !== owner) return false
  const tag = overrides.tags.filter(tag => tag[0] === 'pp' && tag[1] === owner).at(-1)
  return tag ? entryState(tag).pinned : false
}

// A removed entry only excludes a peer that a kind-3 snapshot follows. Keep
// every override while the public snapshot is unknown: a missing list may
// follow the peer. The local CRDT merge turns an omitted entry into a durable
// tombstone, so dropping the tag here removes it across merges.
export function compactContactOverrides (lists, owner, tags) {
  if (lists[0]?.pubkey !== owner) return tags
  const followed = new Set()
  for (const event of lists.slice(0, 2)) {
    if (event?.pubkey !== owner) continue
    for (const tag of event.tags) if (tag[0] === 'p' && hex(tag[1]) && tag[1] !== owner) followed.add(tag[1])
  }
  return tags.filter(tag => tag[0] !== 'pp' || !entryState(tag).removed || followed.has(tag[1]))
}

export function createContacts ({
  owner,
  signer,
  eventStore,
  onChange,
  onState = () => {},
  onError = () => {},
  canMigrate = () => true,
  _getEvents,
  _retryDelays = CONTACTS_REFRESH_DELAYS,
  _isOnline = isOnline,
  _onOnline = onOnline,
  _now = () => Date.now()
}) {
  const lists = [null, null, null]
  let streams = []
  let generation = 0
  let writes = Promise.resolve()
  let context
  let coordinate
  let starting
  let loaded = false
  let remote
  let lifecycle
  let legacyWatch
  let legacy = null
  const publicRead = createRelayRead({ pubkey: owner, kind: 3, getEvents: _getEvents, retryDelays: _retryDelays, retryEmpty: true })
  let pendingPublicList
  const notify = () => onChange(contactMembership(lists, owner), { selfPinned: contactSelfPinned(lists, owner) })
  const isCurrent = version => version === generation
  const nowSeconds = () => Math.floor(_now() / 1000)

  function pause (ms, signal) {
    if (signal.aborted) return Promise.resolve()
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
  }
  function waitForOnline (signal) {
    if (signal.aborted) return Promise.resolve(false)
    return new Promise(resolve => {
      let finished = false
      let stop = () => {}
      const finish = value => {
        if (finished) return
        finished = true
        stop()
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      }
      const onAbort = () => finish(false)
      stop = _onOnline(() => finish(true))
      if (finished) stop()
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

  async function deviceOffline (signal) {
    try {
      const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(CONTACTS_ONLINE_TIMEOUT_MS)])
      return await _isOnline({ signal: probeSignal }) === false
    } catch {
      return false
    }
  }

  async function refreshPublicList (version, signal) {
    while (!signal.aborted && !lists[0]) {
      if (version !== generation) return
      const delay = publicRead.nextAt - Date.now()
      if (!pendingPublicList && !Number.isFinite(delay)) return
      if (!pendingPublicList && delay > 0) { await pause(delay, signal); continue }
      if (!pendingPublicList && await deviceOffline(signal)) {
        if (!await waitForOnline(signal)) return
        continue
      }
      if (signal.aborted || version !== generation || lists[0]) return
      const result = pendingPublicList ? { byPubkey: { [owner]: pendingPublicList }, requests: [] } : await publicRead.query(signal)
      if (version !== generation || signal.aborted) return
      const event = result.byPubkey[owner]
      if (event?.kind === 3 && event.pubkey === owner && isValidEvent(event)) {
        pendingPublicList = event
        // Storage failure is independent of relay success. Retain the signed
        // event so explicit local recovery can retry the write without a fetch.
        try { await eventStore.add(event); pendingPublicList = null } catch (error) { onError(error) }
        return
      }
      const offline = await deviceOffline(signal)
      if (version !== generation || signal.aborted || lists[0]) return
      publicRead.settle(result, { online: !offline })
      if (result.error) onError(result.error)
      if (offline && !await waitForOnline(signal)) return
    }
  }

  function contactListFilter () {
    return { kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': [String(CONTACT_LIST_KIND)], '#v': ['0', '1'], limit: 1 }
  }
  function legacyFilter () {
    return { kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': [String(LEGACY_CONTACT_LIST_KIND)], '#v': ['0', '1'], '#d': [coordinate], limit: 1 }
  }
  function deletionFilter () {
    return { kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': [String(DELETION)], '#v': ['0', '1'], limit: 32 }
  }

  async function decryptSnapshot (wrapper) {
    return decryptPersonalCopy(wrapper, { pubkey: owner, signer, encodedContext: context })
  }

  async function readContactList (version) {
    const { results = [] } = await eventStore.query(contactListFilter())
    let current = null
    for (const wrapper of results) {
      if (!isCurrent(version)) return null
      const event = await decryptSnapshot(wrapper)
      if (isCurrent(version) && isContactList(event, owner)) current = preferred(current, event)
    }
    return current
  }

  async function readLegacy (version) {
    const { results = [] } = await eventStore.query(legacyFilter())
    let current = null
    for (const wrapper of results) {
      if (!isCurrent(version)) return null
      const event = await decryptSnapshot(wrapper)
      if (isCurrent(version) && isLegacyContactList(event, owner)) current = preferred(current, event)
    }
    return current
  }

  async function readLegacyCutoff (version) {
    const { results = [] } = await eventStore.query(deletionFilter())
    let cutoff = 0
    for (const wrapper of results) {
      if (!isCurrent(version)) return cutoff
      const event = await decryptSnapshot(wrapper)
      if (event?.kind !== DELETION || !isInnerEvent(event, owner)) continue
      const targetsLegacy = event.tags.some(tag => tag[0] === 'a' && tag[1] === legacyAddress(owner))
      if (targetsLegacy) cutoff = Math.max(cutoff, Number(event.created_at) || 0)
    }
    return cutoff
  }

  async function withContactLock (version, work) {
    const run = async () => {
      if (!isCurrent(version)) throw new Error('CONTACTS_UNAVAILABLE')
      return work()
    }
    const locks = globalThis.navigator?.locks
    if (typeof locks?.request !== 'function') return run()
    return locks.request(`${CONTACT_LIST_LOCK_PREFIX}${owner}`, { signal: lifecycle?.signal }, run)
  }

  function enqueue (version, work) {
    const task = writes.catch(() => {}).then(() => isCurrent(version) ? work() : undefined)
    writes = task
    return task
  }

  async function emitLegacyDeletion (version, source, knownCutoff) {
    if (!source || !canMigrate() || !isCurrent(version)) return false
    const cutoff = knownCutoff ?? await readLegacyCutoff(version)
    const createdAt = Math.max(nowSeconds(), Number(source.created_at) || 0)
    if (createdAt <= cutoff) return false
    const deletion = {
      kind: DELETION,
      created_at: createdAt,
      tags: [['a', legacyAddress(owner)], ['k', String(LEGACY_CONTACT_LIST_KIND)]],
      content: ''
    }
    const result = await eventStore.addPersonalCopy(deletion, { context: '' })
    if (!result?.result?.ok) throw new Error('CONTACT_STORAGE_FAILED')
    return true
  }

  async function reportDeletionFailure (version, task) {
    try {
      await task
    } catch (error) {
      if (isCurrent(version)) onError(error)
    }
  }

  function startLegacyWatch (version) {
    if (legacyWatch || !isCurrent(version)) return
    const stream = eventStore.subscribe(legacyFilter(), { initial: false })
    legacyWatch = stream
    const consume = async () => {
      for await (const item of stream) {
        if (!isCurrent(version)) return
        if (item.type !== 'event') continue
        const event = await decryptSnapshot(item.event)
        if (!isCurrent(version) || !isLegacyContactList(event, owner)) continue
        legacy = preferred(legacy, event)
        enqueue(version, () => withContactLock(version, async () => {
          if (!canMigrate() || !isCurrent(version)) return
          const cutoff = await readLegacyCutoff(version)
          await reportDeletionFailure(version, emitLegacyDeletion(version, legacy, cutoff))
        })).catch(error => {
          if (isCurrent(version)) onError(error)
        })
      }
    }
    consume().catch(error => {
      if (isCurrent(version)) onError(error)
    })
  }

  function reconcileLegacy (version, candidate) {
    if (!canMigrate()) return
    enqueue(version, () => withContactLock(version, async () => {
      if (!canMigrate() || !isCurrent(version)) return
      const authoritative = await readContactList(version)
      if (!isCurrent(version) || !canMigrate()) return
      if (authoritative) {
        lists[2] = authoritative
        if (loaded) notify()
      }
      const storedLegacy = await readLegacy(version)
      if (!isCurrent(version) || !canMigrate()) return
      if (storedLegacy) legacy = storedLegacy
      if (!authoritative) {
        const source = storedLegacy || candidate || legacy
        if (!source) return
        const migrated = migrateLegacyContactList(source, _now())
        const result = await eventStore.addPersonalCopy(migrated, { context: '' })
        if (!result?.result?.ok) throw new Error('CONTACT_STORAGE_FAILED')
        if (!isCurrent(version)) return
        legacy = source
        lists[2] = { ...migrated, pubkey: owner, id: 'f'.repeat(64) }
        notify()
        startLegacyWatch(version)
        const cutoff = await readLegacyCutoff(version)
        await reportDeletionFailure(version, emitLegacyDeletion(version, source, cutoff))
        return
      }
      if (!legacy || !canMigrate()) return
      const cutoff = await readLegacyCutoff(version)
      await reportDeletionFailure(version, emitLegacyDeletion(version, legacy, cutoff))
    })).catch(error => {
      if (isCurrent(version)) onError(error)
    })
  }

  function start () {
    if (starting) return starting
    starting = open().finally(() => { starting = null })
    return starting
  }
  async function open () {
    const version = ++generation
    remote?.abort()
    lifecycle?.abort()
    legacyWatch?.return().catch(() => {})
    legacyWatch = null
    remote = new AbortController()
    lifecycle = new AbortController()
    const signal = remote.signal
    const initial = Promise.withResolvers()
    const cancel = () => initial.resolve(false)
    signal.addEventListener('abort', cancel, { once: true })
    let failed = false
    const fail = error => {
      if (version !== generation) return
      failed = true
      loaded = false
      onState('unavailable')
      onError(error)
      initial.resolve(false)
    }
    loaded = false
    legacy = null
    onState('loading')
    // Keep displayed contacts until all local snapshots are decrypted.
    // Neither relay discovery nor message transport readiness gates these reads.
    lists.fill(null)
    for (const stream of streams) stream.return().catch(() => {})
    streams = []
    try {
      context = await signer.obfuscate('', String(PERSONAL_COPY), '')
      if (version !== generation) return false
      coordinate = await signer.obfuscate(`${context}:${FOLLOW_SET}:${owner}:${CONTACTS_DTAG}`, String(PERSONAL_COPY), '.coordinate')
      if (version !== generation) return false
      const filters = [
        { kinds: [3], authors: [owner], limit: 1 },
        { kinds: [PERSONAL_COPY], authors: [owner], '#c': [context], '#k': ['3'], '#v': ['0', '1'], '#d': [coordinate], limit: 1 },
        contactListFilter(),
        // Admit the legacy permission with the other local snapshots. Its
        // payload is retained but not decrypted or displayed if 13300 exists.
        legacyFilter()
      ]
      const snapshots = new Set()
      let authoritative = false
      let migrationCandidate = null
      let legacyWrapper = null
      for (const [index, filter] of filters.entries()) {
        const stream = eventStore.subscribe(filter, { initial: true })
        streams.push(stream)
        const consume = async () => {
          for await (const item of stream) {
            if (version !== generation) return
            if (item.type === 'eose') {
              snapshots.add(index)
              if (snapshots.size === filters.length && !failed && !loaded) {
                if (!authoritative) {
                  migrationCandidate = legacyWrapper && await decryptSnapshot(legacyWrapper)
                  if (!isCurrent(version)) return
                  if (!authoritative && isLegacyContactList(migrationCandidate, owner)) {
                    legacy = migrationCandidate
                    lists[2] = { ...migrateLegacyContactList(migrationCandidate, _now()), pubkey: owner, id: 'f'.repeat(64) }
                  } else {
                    migrationCandidate = null
                  }
                }
                loaded = true
                notify()
                onState('loaded')
                initial.resolve(true)
                if (authoritative) {
                  startLegacyWatch(version)
                  reconcileLegacy(version)
                } else if (migrationCandidate) reconcileLegacy(version, migrationCandidate)
                // A missing public list can recover remotely in the background.
                // A cached list needs no startup relay discovery or retry loop.
                refreshPublicList(version, signal).catch(error => { if (version === generation && !signal.aborted) onError(error) })
              }
              continue
            }
            if (item.type !== 'event') continue
            if (index === 3) {
              legacyWrapper = preferred(legacyWrapper, item.event)
              continue
            }
            const event = index ? await decryptSnapshot(item.event) : item.event
            if (version !== generation) return
            if (!event || event.pubkey !== owner || (!index && !isValidEvent(event))) continue
            if (index === 2) {
              if (!isContactList(event, owner)) continue
              authoritative = true
              lists[2] = preferred(lists[2], event)
              if (loaded) startLegacyWatch(version)
            } else {
              if (!isInnerEvent(event, owner)) continue
              lists[index] = preferred(lists[index], event)
            }
            if (loaded) notify()
          }
          if (version === generation && !snapshots.has(index)) throw new Error('CONTACTS_SNAPSHOT_INCOMPLETE')
        }
        consume().catch(fail)
      }
      return await initial.promise
    } catch (error) { fail(error); return false } finally { signal.removeEventListener('abort', cancel) }
  }

  // Peer pin edits require membership and materialize base-list metadata so an
  // entry cannot erase relay hints or petnames. Self membership stays implicit;
  // only its pin preference is written. Removing an external contact clears pin.
  function update (peer, change) {
    if (!hex(peer) || (peer === owner && change.included !== undefined)) return Promise.reject(new Error('INVALID_CONTACT'))
    const work = writes.catch(() => {}).then(async () => {
      if (!loaded && !await start()) throw new Error('CONTACTS_UNAVAILABLE')
      const version = generation
      return withContactLock(version, async () => {
        // Refresh the override before editing; CRDT merging preserves concurrent peers.
        const authoritative = await readContactList(version)
        if (authoritative) lists[2] = preferred(lists[2], authoritative)
        let sourceLegacy = legacy
        if (!authoritative) {
          sourceLegacy = await readLegacy(version) || legacy
          if (sourceLegacy) {
            legacy = sourceLegacy
            lists[2] = { ...migrateLegacyContactList(sourceLegacy, _now()), pubkey: owner, id: 'f'.repeat(64) }
          }
        }
        if (!isCurrent(version)) throw new Error('CONTACTS_UNAVAILABLE')
        const previous = lists[2]
        const existing = previous?.tags.find(tag => tag[0] === 'pp' && tag[1] === peer)
        const existingState = existing ? entryState(existing) : null
        const current = contactMembership(lists, owner).find(contact => contact.pubkey === peer)
        const self = peer === owner
        if (change.included === undefined) {
          if (!self && !current) throw new Error('INVALID_CONTACT')
          if (!change.pinned && (self ? !existing : !existingState?.pinned)) return true
        }
        const included = change.included ?? true
        const pinned = included && (change.pinned ?? existingState?.pinned ?? false)
        const tags = (previous?.tags || []).filter(tag => tag[0] !== 'pp' || tag[1] !== peer)
        // Let the store stamp this changed pp entry; preserve other entries' CRDT
        // data. Removing always clears pin, and the canonical label never
        // combines 'r' with 'p'.
        if (self) {
          // Unpinning self omits the entry: the store records its CRDT removal.
          if (pinned) tags.push(['pp', owner, '', '', 'p'])
        } else {
          tags.push(['pp', peer, existingState?.relayHint || current?.relayHint || '', existingState?.petname || current?.petname || '', included ? (pinned ? 'p' : '') : 'r'])
        }
        // Best-effort compaction on every edit. Entries that no longer negate a
        // follow are dropped so the override only carries live decisions.
        const event = {
          kind: CONTACT_LIST_KIND,
          created_at: Math.max(nowSeconds(), (previous?.created_at || 0) + 1),
          tags: compactContactOverrides(lists, owner, tags),
          content: previous?.content || ''
        }
        const result = await eventStore.addPersonalCopy(event, { context: '' })
        if (!result?.result?.ok) throw new Error('CONTACT_STORAGE_FAILED')
        if (!isCurrent(version)) throw new Error('CONTACTS_UNAVAILABLE')
        // Read the authoritative merged row on replay; refresh the in-memory snapshot.
        lists[2] = { ...event, pubkey: owner, id: 'f'.repeat(64) }
        notify()
        if (sourceLegacy) {
          const cutoff = await readLegacyCutoff(version)
          await reportDeletionFailure(version, emitLegacyDeletion(version, sourceLegacy, cutoff))
        }
        return true
      })
    })
    writes = work
    return work
  }

  return {
    start,
    set: (peer, included) => update(peer, { included }),
    setPin: (peer, pinned) => update(peer, { pinned }),
    close () {
      generation++
      remote?.abort()
      lifecycle?.abort()
      legacyWatch?.return().catch(() => {})
      legacyWatch = null
      for (const stream of streams) stream.return().catch(() => {})
      streams = []
    }
  }
}
