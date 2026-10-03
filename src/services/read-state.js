import { PERSONAL_COPY } from 'libp2r2p/kind'
import { decryptPersonalCopy } from './chat-references.js'
import { compareChatMessages } from '#helpers/conversation-preview.js'

// Read state lives in one owner-authored addressable personal copy per peer
// (`+zillion:read:<peer>`), inside the empty obfuscation context like the
// contact overrides. The anchor travels in plain tags, never JSON content.
export const READ_STATE_KIND = 30078
export const READ_STATE_DTAG_PREFIX = '+zillion:read:'
export const UNREAD_COUNT_CAP = 100

const WRITE_DELAY_MS = 5000
const COUNT_PAGE_SIZE = 50
const COUNT_PAGE_LIMIT = 8
const HEX64_RE = /^[0-9a-f]{64}$/i

export const readStateDtag = peer => `${READ_STATE_DTAG_PREFIX}${peer}`

export function sameReadAnchor (a, b) {
  if (!a || !b) return a === b
  return a.id === b.id && a.created_at === b.created_at
}

// Newest timestamp wins; ties resolve to the lowest event ID, matching the
// chat timeline order where a lower ID renders later in the same second.
export function chooseReadAnchor (anchors) {
  let winner = null
  for (const anchor of anchors) if (!winner || compareChatMessages(anchor, winner) > 0) winner = anchor
  return winner
}

// NostrDB decorates owner-authored tags with reserved "~..." values in extra
// slots. Only the first three positions form the anchor and stay portable
// across a copy into a new event.
export function parseReadAnchors (event) {
  const anchors = []
  for (const tag of event?.tags ?? []) {
    if (tag?.[0] !== 'anchor') continue
    const id = typeof tag[1] === 'string' ? tag[1] : ''
    if (!HEX64_RE.test(id)) continue
    const raw = tag[2]
    const createdAt = typeof raw === 'number' ? raw : /^\d{1,10}$/.test(typeof raw === 'string' ? raw : '') ? Number(raw) : NaN
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) continue
    anchors.push({ id, created_at: createdAt })
  }
  return anchors
}

export function hasReadAnchorTag (event, peer) {
  const dtag = readStateDtag(peer)
  return event?.tags?.some(tag => tag[0] === 'd' && tag[1] === dtag) === true
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

// Outgoing bubbles never wait for the dwell. A message advances the anchor as
// soon as its publication saves, but only when this session observed it before
// confirmation so replayed history cannot skip unread messages.
export function createOutgoingReads () {
  const unconfirmed = new Set()
  const advanced = new Set()
  return {
    published (messages) {
      const anchors = []
      for (const message of messages) {
        if (!message?.outgoing) continue
        if (message.status !== 'saved') { unconfirmed.add(message.id); continue }
        if (!unconfirmed.has(message.id) || advanced.has(message.id)) continue
        advanced.add(message.id)
        anchors.push({ id: message.id, created_at: message.created_at })
      }
      return anchors
    }
  }
}

export function createReadState ({ pubkey, signer, eventStore, onChange = () => {}, onError = () => {}, writeDelayMs = WRITE_DELAY_MS }) {
  const entries = new Map()
  let contextPromise
  let closed = false
  const active = entry => !closed && entries.get(entry.peer) === entry
  const context = () => (contextPromise ??= signer.obfuscate('', String(PERSONAL_COPY), '').catch(error => {
    contextPromise = undefined
    throw error
  }))
  const emit = entry => { if (active(entry)) onChange(entry.peer, entry.anchor ? { ...entry.anchor } : null) }

  function schedule (entry, delay = writeDelayMs) {
    if (!active(entry)) return
    if (entry.timer) return
    entry.timer = setTimeout(() => { entry.timer = null; persist(entry) }, delay)
  }

  function persist (entry) {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null }
    if (entry.writing) { entry.pending = true; return entry.writing }
    const anchor = entry.anchor
    if (!anchor || (!entry.needsRepair && sameReadAnchor(entry.stored, anchor))) return Promise.resolve()
    const work = (async () => {
      // Monotonic versions compare against the stored coordinate, so wait for
      // the initial read instead of racing it with a lower timestamp.
      await entry.ready
      const createdAt = Math.max(nowSeconds(), (entry.version || 0) + 1)
      const event = {
        kind: READ_STATE_KIND,
        created_at: createdAt,
        tags: [['d', readStateDtag(entry.peer)], ['anchor', anchor.id, String(anchor.created_at)]],
        content: ''
      }
      const result = await eventStore.addPersonalCopy(event, { context: '' })
      if (!result?.result?.ok) throw new Error('READ_STATE_STORAGE_FAILED')
      entry.version = createdAt
      entry.stored = anchor
      entry.anchors = 1
      entry.needsRepair = false
    })().catch(error => { if (active(entry)) onError(error) })
    entry.writing = work
    return work.finally(() => {
      if (entry.writing !== work) return
      entry.writing = null
      const dirty = entry.anchor && (entry.needsRepair || !sameReadAnchor(entry.stored, entry.anchor))
      const pending = entry.pending
      entry.pending = false
      if (pending && dirty) persist(entry)
    })
  }

  function applyVersion (entry, event) {
    if (!hasReadAnchorTag(event, entry.peer)) return
    // Addressable replacement keeps one coordinate, but a live replay can still
    // deliver an older version after a newer one.
    if (event.created_at < (entry.version || 0)) return
    const anchors = parseReadAnchors(event)
    const winner = chooseReadAnchor(anchors)
    if (event.created_at > entry.version) {
      entry.version = event.created_at
      entry.stored = winner
      entry.anchors = anchors.length
    } else {
      entry.stored = chooseReadAnchor([entry.stored, winner].filter(Boolean)) || null
      entry.anchors = Math.max(entry.anchors, anchors.length)
    }
    if (anchors.length > 1) entry.needsRepair = true
    const next = chooseReadAnchor([entry.anchor, winner].filter(Boolean)) || null
    if (!sameReadAnchor(next, entry.anchor)) { entry.anchor = next; emit(entry) }
    if (entry.needsRepair || (entry.anchor && !sameReadAnchor(entry.stored, entry.anchor))) schedule(entry)
  }

  async function open (entry, resolveReady) {
    try {
      const encodedContext = await context()
      const coordinate = await signer.obfuscate(
        `${encodedContext}:${READ_STATE_KIND}:${pubkey}:${readStateDtag(entry.peer)}`,
        String(PERSONAL_COPY),
        '.coordinate'
      )
      if (!active(entry)) { resolveReady(false); return }
      const stream = eventStore.subscribe({
        kinds: [PERSONAL_COPY], authors: [pubkey], '#c': [encodedContext], '#k': [String(READ_STATE_KIND)], '#v': ['0', '1'], '#d': [coordinate], limit: 1
      }, { initial: true })
      entry.stream = stream
      ;(async () => {
        let loaded = false
        for await (const item of stream) {
          if (!active(entry)) return
          if (item.type === 'eose') {
            loaded = true
            entry.state = 'loaded'
            resolveReady(true)
            emit(entry)
            continue
          }
          if (item.type !== 'event') continue
          const event = await decryptPersonalCopy(item.event, { pubkey, signer, encodedContext })
          if (!active(entry) || !event) continue
          applyVersion(entry, event)
        }
        // The live subscription should stay open; a closed one leaves the
        // last known anchor usable and can be retried by a later ensure().
        if (active(entry) && !loaded) {
          entry.state = 'unavailable'
          resolveReady(false)
        }
      })().catch(error => {
        if (!active(entry)) return
        entry.state = 'unavailable'
        resolveReady(false)
        onError(error)
      })
    } catch (error) {
      if (!active(entry)) { resolveReady(false); return }
      entry.state = 'unavailable'
      resolveReady(false)
      onError(error)
    }
  }

  function ensureEntry (peer) {
    let entry = entries.get(peer)
    if (entry) return entry
    const ready = Promise.withResolvers()
    entry = {
      peer,
      ready: ready.promise,
      resolveReady: ready.resolve,
      state: 'loading',
      anchor: null,
      stored: null,
      version: 0,
      anchors: 0,
      needsRepair: false,
      pending: false,
      timer: null,
      writing: null,
      stream: null
    }
    entries.set(peer, entry)
    open(entry, ready.resolve)
    return entry
  }

  function ensure (peer) {
    if (closed || !HEX64_RE.test(peer || '') || peer === pubkey) return Promise.resolve(false)
    return ensureEntry(peer).ready
  }

  function release (peer) {
    const entry = entries.get(peer)
    if (!entry) return
    entry.resolveReady(false)
    persist(entry)
    entries.delete(peer)
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null }
    entry.stream?.return().catch(() => {})
  }

  return {
    ensure,
    anchor: peer => entries.get(peer)?.anchor ?? null,
    state: peer => entries.get(peer)?.state ?? 'loading',
    advance (peer, anchor) {
      if (closed || !HEX64_RE.test(peer || '') || peer === pubkey) return
      if (!anchor || !HEX64_RE.test(anchor.id || '') || !Number.isSafeInteger(anchor.created_at) || anchor.created_at < 0) return
      const entry = ensureEntry(peer)
      const next = chooseReadAnchor([entry.anchor, anchor])
      if (sameReadAnchor(next, entry.anchor)) return
      entry.anchor = next
      emit(entry)
      schedule(entry)
    },
    // The contact list owns the long-lived subscriptions; removed peers stop
    // reading but an unflushed anchor is written before release.
    setPeers (peers) {
      if (closed) return Promise.resolve([])
      const wanted = new Set((peers || []).filter(peer => HEX64_RE.test(peer) && peer !== pubkey))
      for (const peer of [...entries.keys()]) if (!wanted.has(peer)) release(peer)
      for (const peer of wanted) ensureEntry(peer)
      return Promise.all([...wanted].map(peer => entries.get(peer).ready))
    },
    flush (peer) {
      if (closed) return Promise.resolve()
      if (peer) { const entry = entries.get(peer); return entry ? persist(entry) : Promise.resolve() }
      return Promise.all([...entries.values()].map(entry => persist(entry)))
    },
    close () {
      if (closed) return
      closed = true
      for (const entry of entries.values()) {
        entry.resolveReady(false)
        if (entry.timer) clearTimeout(entry.timer)
        entry.timer = null
        // A close during unload still starts the durable write.
        persist(entry)
        entry.stream?.return().catch(() => {})
      }
      entries.clear()
    }
  }
}

// Exact incoming-message count above the anchor, bounded by the badge cap.
// Wrapper ciphertext is the only input; nothing is cached here.
export function createUnreadCounter ({ pubkey, signer, eventStore, cap = UNREAD_COUNT_CAP }) {
  const contexts = new Map()
  const context = peer => {
    if (!contexts.has(peer)) {
      contexts.set(peer, signer.obfuscate(`dm:${peer}`, String(PERSONAL_COPY), '').catch(error => {
        contexts.delete(peer)
        throw error
      }))
    }
    return contexts.get(peer)
  }
  return {
    async count (peer, anchor) {
      if (!HEX64_RE.test(peer || '') || peer === pubkey) return 0
      const encodedContext = await context(peer)
      const floor = anchor?.created_at ?? null
      let count = 0
      let boundary = null
      for (let page = 0; page < COUNT_PAGE_LIMIT && count < cap; page++) {
        const { results = [] } = await eventStore.query({
          kinds: [PERSONAL_COPY], authors: [pubkey], '#k': ['9'], '#c': [encodedContext], '#v': ['0', '1'],
          ...(floor === null ? {} : { since: floor }),
          ...(boundary ? { until: boundary.timestamp, '!ids': [...boundary.ids] } : {}),
          limit: COUNT_PAGE_SIZE
        })
        if (!results.length) break
        for (const wrapper of results) {
          const event = await decryptPersonalCopy(wrapper, { pubkey, signer, encodedContext, authors: [pubkey, peer] })
          if (event?.pubkey !== peer) continue
          if (anchor && compareChatMessages(event, anchor) <= 0) continue
          count++
          if (count >= cap) break
        }
        const oldest = results[results.length - 1]
        if (!Number.isSafeInteger(oldest.created_at)) break
        if (results.length < COUNT_PAGE_SIZE) break
        const ids = results.filter(wrapper => wrapper.created_at === oldest.created_at).map(wrapper => wrapper.id)
        if (boundary?.timestamp === oldest.created_at) for (const id of ids) boundary.ids.add(id)
        else boundary = { timestamp: oldest.created_at, ids: new Set(ids) }
      }
      return count
    }
  }
}
