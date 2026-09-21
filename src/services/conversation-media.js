import { PERSONAL_COPY } from 'libp2r2p/kind'
import { decryptPersonalCopy } from './chat-references.js'
import { messageAttachment } from './chat-attachments.js'
import { compareMedia, isViewerMime, safeMediaUrl, VIEWER_MIMES } from '#helpers/viewer-media.js'

const PAGE_SIZE = 3
const CACHE_SIZE = 12
const empty = () => ({ current: null, previous: null, next: null, index: -1, total: 0 })

// No file bytes or account-wide reference cache belong to this read session.
// The only unbounded input is the small descriptors of already loaded URLs.
export function createConversationMediaReader ({ pubkey, signer, eventStore, context = `dm:${pubkey}`, extras = [], onInvalidate = () => {}, onError = () => {} }) {
  let urls = extras.map(item => ({ ...item })).sort(compareMedia)
  const cache = new Map()
  const groups = new Map()
  const streams = []
  let closed = false
  let initialized
  let filter
  let encodedContext
  let total = null
  let state = empty()
  let requestedId = null
  let queue = Promise.resolve()
  let timer
  let revision = 0
  const check = () => { if (closed) throw new DOMException('Reader closed', 'AbortError') }
  const serial = fn => {
    const work = queue.catch(() => {}).then(() => { check(); return fn() })
    queue = work
    return work
  }
  const invalidate = () => {
    if (closed) return
    revision++
    cache.clear(); groups.clear(); total = null
    clearTimeout(timer)
    timer = setTimeout(() => { if (!closed) onInvalidate() }, 30)
  }
  const query = async extra => {
    check()
    const { results = [] } = await eventStore.query({ ...filter, ...extra })
    check()
    return results
  }
  const count = async extra => {
    check()
    const value = await eventStore.count({ ...filter, ...extra })
    check()
    return value
  }
  const decrypt = wrapper => decryptPersonalCopy(wrapper, { pubkey, signer, encodedContext })
  async function init () {
    if (initialized) return initialized
    initialized = (async () => {
      encodedContext = await signer.obfuscate(context, String(PERSONAL_COPY), '')
      const mirrors = await Promise.all(VIEWER_MIMES.map(mime => signer.obfuscate(mime, String(PERSONAL_COPY), '#m')))
      check()
      filter = { kinds: [PERSONAL_COPY], authors: [pubkey], '#c': [encodedContext], '#k': ['1063'], '#v': ['0', '1'], '#o': mirrors }
      const deletionFilter = { ...filter, '#k': ['5'] }
      delete deletionFilter['#o']
      for (const [selection, deletion] of [[filter, false], [deletionFilter, true]]) {
        const stream = eventStore.subscribe(selection)
        streams.push(stream)
        ;(async () => {
          for await (const { result } of stream) {
            check()
            if (deletion) {
              const event = await decrypt(result)
              check()
              if (event?.kind !== 5) continue
              const removed = new Set(event.tags.filter(tag => tag[0] === 'e').map(tag => tag[1]))
              urls = urls.filter(item => !removed.has(item.messageId))
            }
            invalidate()
          }
        })().catch(error => { if (!closed) onError(error) })
      }
    })().catch(error => { initialized = null; throw error })
    return initialized
  }
  async function decode (wrapper) {
    if (cache.has(wrapper.id)) return cache.get(wrapper.id)
    const version = revision
    const event = await decrypt(wrapper).catch(() => null)
    check()
    const file = messageAttachment(event)
    const valid = event?.kind === 1063 && isViewerMime(file?.mime) && safeMediaUrl(file?.url)
    const item = {
      ...(valid ? file : {}),
      id: event?.kind === 1063 ? `file:${event.id}` : `copy:${wrapper.id}`,
      wrapperId: wrapper.id, orderId: wrapper.id, created_at: wrapper.created_at,
      type: file?.mime?.startsWith('video/') ? 'video' : 'image',
      unavailable: !valid
    }
    if (version === revision) {
      cache.set(wrapper.id, item)
      while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value)
    }
    return item
  }
  // Inclusive time filters alone lose ties. Only IDs from up to three active
  // timestamp buckets are retained, never every visited event or ciphertext.
  async function idsAt (timestamp) {
    if (groups.has(timestamp)) return groups.get(timestamp)
    const version = revision
    const seen = new Set()
    for (;;) {
      const ids = await query({ since: timestamp, until: timestamp, ids_only: true, limit: 200, ...(seen.size ? { '!ids': [...seen] } : {}) })
      const size = seen.size
      for (const id of ids) seen.add(id)
      if (ids.length < 200 || seen.size === size) break
    }
    const ids = [...seen].sort().reverse()
    if (version === revision) {
      groups.set(timestamp, ids)
      while (groups.size > 3) groups.delete(groups.keys().next().value)
    }
    return ids
  }
  async function filesNear (anchor, step) {
    let timestamp = anchor?.created_at
    let boundary = anchor?.orderId
    const wanted = []
    while (wanted.length < PAGE_SIZE) {
      if (timestamp == null) {
        const [edge] = await query({ limit: 1, search: `sort:${step > 0 ? 'asc' : 'desc'}` })
        if (!edge) break
        timestamp = edge.created_at
      }
      let ids = await idsAt(timestamp)
      if (boundary != null) ids = ids.filter(id => step > 0 ? id < boundary : id > boundary)
      if (step < 0) ids = [...ids].reverse()
      wanted.push(...ids.slice(0, PAGE_SIZE - wanted.length))
      if (wanted.length === PAGE_SIZE || (step < 0 && timestamp <= 0)) break
      const [edge] = await query({ ...(step > 0 ? { since: timestamp + 1 } : { until: timestamp - 1 }), limit: 1, search: `sort:${step > 0 ? 'asc' : 'desc'}` })
      if (!edge) break
      timestamp = edge.created_at
      boundary = null
    }
    const missing = wanted.filter(id => !cache.has(id))
    const decoded = new Map()
    if (missing.length) {
      for (const wrapper of await query({ ids: missing, limit: PAGE_SIZE })) decoded.set(wrapper.id, await decode(wrapper))
    }
    return wanted.map(id => cache.get(id) ?? decoded.get(id)).filter(Boolean)
  }
  async function find (id) {
    const url = urls.find(item => item.id === id)
    if (url) return url
    let lookup
    if (/^file:[a-f0-9]{64}$/i.test(id)) lookup = { '&o': [await signer.obfuscate(id.slice(5), String(PERSONAL_COPY), '.id')] }
    else if (/^copy:[a-f0-9]{64}$/i.test(id)) lookup = { ids: [id.slice(5)] }
    else return null
    const [wrapper] = await query({ ...lookup, limit: 1 })
    if (wrapper && cache.get(wrapper.id)?.unavailable) cache.delete(wrapper.id)
    return wrapper ? decode(wrapper) : null
  }
  function urlBoundary (anchor, after = false) {
    let low = 0; let high = urls.length
    while (low < high) {
      const middle = (low + high) >>> 1
      const order = compareMedia(urls[middle], anchor)
      if (order < 0 || (after && order === 0)) low = middle + 1
      else high = middle
    }
    return low
  }
  async function adjacent (anchor, step) {
    const files = await filesNear(anchor, step)
    const index = anchor ? step > 0 ? urlBoundary(anchor, true) : urlBoundary(anchor) - 1 : step > 0 ? 0 : urls.length - 1
    const url = urls[index]
    const file = files[0]
    if (!file) return url ?? null
    return url && compareMedia(url, file) * step < 0 ? url : file
  }
  async function ordinal (item) {
    let before = item.created_at > 0 ? await count({ until: item.created_at - 1 }) : 0
    const ids = await idsAt(item.created_at)
    before += ids.filter(id => id > item.orderId).length
    return before + urlBoundary(item)
  }
  async function snapshot (current, index) {
    const version = revision
    if (total == null) total = await count({})
    const result = { ...empty(), total: total + urls.length }
    if (current) {
      result.current = current
      result.index = index ?? await ordinal(current)
      result.previous = await adjacent(current, -1)
      result.next = await adjacent(current, 1)
    }
    check()
    if (version !== revision) {
      total = null
      const anchor = current
      const latest = anchor ? await find(anchor.id) ?? await adjacent(anchor, 1) ?? await adjacent(anchor, -1) : null
      return snapshot(latest)
    }
    if (current) requestedId = current.id
    else if (state.current) requestedId = null
    state = result
    return result
  }
  return {
    open: id => serial(async () => {
      await init()
      requestedId = id || null
      state = empty()
      return snapshot(id ? await find(id) : await adjacent(null, 1))
    }),
    move: step => serial(async () => {
      const current = step > 0 ? state.next : state.previous
      return current ? snapshot(current, state.index + (step > 0 ? 1 : -1)) : state
    }),
    refresh: () => serial(async () => {
      await init()
      cache.clear(); groups.clear(); total = null
      const anchor = state.current
      const current = anchor ? await find(anchor.id) ?? await adjacent(anchor, 1) ?? await adjacent(anchor, -1) : requestedId ? await find(requestedId) : await adjacent(null, 1)
      return snapshot(current)
    }),
    close () {
      if (closed) return
      closed = true; clearTimeout(timer)
      for (const stream of streams) stream.return().catch(() => {})
      streams.length = 0; cache.clear(); groups.clear(); urls = []; state = empty()
    }
  }
}

// Fixture conversations keep their existing order and never read the owner store.
export function createStaticMediaReader (items) {
  let list = items.map(item => ({ ...item }))
  let index = -1
  const state = () => ({ current: list[index] ?? null, previous: index > 0 ? list[index - 1] : null, next: index >= 0 ? list[index + 1] ?? null : null, index, total: list.length })
  return {
    async open (id) { index = id ? list.findIndex(item => item.id === id) : list.length ? 0 : -1; return state() },
    async move (step) { if (index + step >= 0 && index + step < list.length) index += step; return state() },
    async refresh () { return state() },
    close () { list = []; index = -1 }
  }
}
