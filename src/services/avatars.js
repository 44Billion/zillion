import { onOnline } from 'libp2r2p/network'
import { isDataAvatarPicture } from '#helpers/avatar.js'
import { abortable } from '#helpers/media-dimensions.js'
import { createAvatarPresentation, getAvatarInitialTimeout, getAvatarAttemptTimeout } from './avatar-presentation.js'

const IDLE_BYTES = 32 * 1024 * 1024
const IDLE_ENTRIES = 256
const RETRY_DELAYS = [1000, 4000]
let nextGeneration = 0
const newer = (a, b) => !a || (b && (b.created_at > a.created_at || (b.created_at === a.created_at && b.id <= a.id)))

// Account-owned runtime. Source strings, promises, DOM drawables and controllers
// stay here; the account store receives only visual state and resource tokens.
export function createAvatars ({ cache, onState, watchOnline = onOnline, now = Date.now, maxIdleBytes = IDLE_BYTES, maxIdleEntries = IDLE_ENTRIES }) {
  const generation = ++nextGeneration
  const entries = new Map()
  const sources = new Map()
  let active = 0
  let nextToken = 0
  let closed = false
  const wanted = url => [...entries.values()].some(entry => entry.consumers.size && entry.url === url)
  const pinned = url => wanted(url) || [...entries.values()].some(entry => entry.consumers.size && entry.visual?.displayed?.url === url)
  const current = source => !closed && sources.get(source.url) === source
  const candidate = entry => {
    const source = sources.get(entry.url)
    return source?.image && source.status === 'prepared' && (!source.ready || !isDataAvatarPicture(source.image.source))
      ? { id: source.token, pk: entry.key, url: source.url, src: source.image.source, timeout: source.timeout }
      : null
  }
  function publish (entry) {
    if (closed || entries.get(entry.key) !== entry) return
    entry.snapshot = { ...entry.visual, candidate: candidate(entry) }
    const displayed = entry.visual?.displayed
    const token = displayed ? sources.get(displayed.url)?.token : null
    const state = { initial: entry.visual?.initial ?? true, picture: entry.url, displayed: displayed ? { url: displayed.url, token } : null, candidate: entry.snapshot.candidate?.id ?? null }
    const previous = entry.state
    if (previous && previous.initial === state.initial && previous.picture === state.picture && previous.displayed?.url === state.displayed?.url && previous.displayed?.token === state.displayed?.token && previous.candidate === state.candidate) return
    entry.state = state
    onState(entry.key, state)
  }
  function present (entry, source) {
    entry.model?.present({ pk: entry.key, url: source.url, src: source.image.source })
  }
  function changed (source) {
    for (const entry of entries.values()) {
      if (entry.url !== source.url || !entry.model) continue
      if (source.status === 'failed') entry.model.reject({ pk: entry.key, url: source.url })
      else if (source.ready) present(entry, source)
      publish(entry)
    }
  }
  function trim () {
    for (const source of sources.values()) if (!wanted(source.url)) { source.controller?.abort(); clearTimeout(source.retryTimer); source.retryTimer = null }
    const idle = [...sources.values()].filter(source => !pinned(source.url)).sort((a, b) => a.used - b.used)
    let bytes = idle.reduce((total, source) => total + (source.bytes || 0), 0)
    let count = idle.length
    for (const source of idle) {
      if (bytes <= maxIdleBytes && count <= maxIdleEntries) break
      sources.delete(source.url); source.controller?.abort(); clearTimeout(source.retryTimer)
      bytes -= source.bytes || 0; count--
      for (const entry of entries.values()) {
        if (!entry.consumers.size && (entry.url === source.url || entry.visual?.displayed?.url === source.url)) {
          if (entry.visual?.displayed?.url === source.url) entry.visual = { ...entry.visual, displayed: null }
          publish(entry)
        }
      }
    }
    const unused = [...entries.values()].filter(entry => !entry.consumers.size).sort((a, b) => a.used - b.used)
    for (const entry of unused.slice(0, Math.max(0, unused.length - maxIdleEntries))) {
      entries.delete(entry.key)
      onState(entry.key, null)
    }
  }
  function fail (source) {
    if (!current(source) || source.ready || source.status === 'failed') return
    source.status = 'failed'
    source.controller?.abort()
    if (!wanted(source.url)) return
    if (source.attempt < RETRY_DELAYS.length) {
      source.retryTimer = setTimeout(() => {
        source.retryTimer = null
        if (current(source) && wanted(source.url)) load(source.url, { retry: true, attempt: source.attempt + 1 })
      }, RETRY_DELAYS[source.attempt])
    }
    changed(source)
  }
  function rejectIfAllFailed (source) {
    if (!source || source.ready || source.status !== 'prepared') return
    const pending = [...entries.values()].some(entry => entry.url === source.url && [...entry.consumers].some(consumer => consumer.failed !== source.token))
    if (!pending) fail(source)
  }
  function rejectCandidate (entry, value, consumer) {
    const source = sources.get(value.url)
    if (closed || !entry || value.pk !== entry.key || entry.url !== value.url || source?.token !== value.id) return
    if (consumer) consumer.failed = source.token
    else for (const consumer of entry.consumers) consumer.failed = source.token
    // One DOM load cannot withdraw the candidate from other mounted views.
    // Their own decode callbacks may still confirm the shared source.
    entry.model?.reject({ pk: entry.key, url: value.url })
    rejectIfAllFailed(source)
    publish(entry)
  }
  function prepared (source, image) {
    if (!current(source) || source.controller.signal.aborted) return
    if (!image) { fail(source); return }
    source.image = image
    source.status = 'prepared'
    source.bytes = image.source.length * 2 + (image.width || 0) * (image.height || 0) * 4
    changed(source)
    trim()
  }
  function pump () {
    if (closed) return
    for (const source of sources.values()) {
      if (active >= 4) break
      if (source.status !== 'queued' || !wanted(source.url)) continue
      source.status = 'working'
      active++
      const controller = source.controller
      const timer = setTimeout(() => controller.abort(), source.timeout)
      ;(async () => {
        try {
          const image = await abortable(cache.resolveImage(source.url, { signal: controller.signal, cached: null, timeout: source.timeout }), controller.signal)
          prepared(source, image)
        } catch {
          fail(source)
        } finally {
          clearTimeout(timer)
          active--
          if (current(source)) source.controller = null
          trim(); pump()
        }
      })()
    }
  }
  function load (url, { manual = false, retry = false, attempt = 0 } = {}) {
    if (!url || closed) return null
    let source = sources.get(url)
    if (source && !retry && ((source.status !== 'failed' && !source.controller?.signal.aborted) || source.retryTimer || (source.status === 'failed' && !manual))) { source.used = now(); return source }
    source?.controller?.abort()
    clearTimeout(source?.retryTimer)
    const timeout = Math.max(...[...entries.values()].filter(entry => entry.url === url && entry.consumers.size).map(entry => entry.attemptTimeout))
    source = { url, token: `${generation}:${++nextToken}`, status: 'local', used: now(), controller: new AbortController(), image: null, ready: false, timeout, attempt, retryTimer: null }
    sources.set(url, source)
    const controller = source.controller
    const timer = setTimeout(() => controller.abort(), source.timeout)
    ;(async () => {
      try {
        const image = isDataAvatarPicture(url) ? null : await abortable(cache.get(url), controller.signal)
        if (!current(source) || controller.signal.aborted) return
        if (image) { prepared(source, image); source.controller = null } else { source.status = 'queued'; pump() }
      } catch {
        fail(source)
      } finally { clearTimeout(timer) }
    })()
    return source
  }
  const stopOnline = watchOnline(() => {
    if (closed) return
    for (const source of sources.values()) {
      if (!wanted(source.url)) continue
      if (source.status === 'failed') load(source.url, { manual: true, retry: true })
      else if (source.ready && !isDataAvatarPicture(source.image.source)) {
        source.token = `${generation}:${++nextToken}`
        changed(source)
      }
    }
  })
  function apply (entry, { url, pending, version } = {}, manual = false) {
    if (closed || !entry.consumers.size) return
    const previousUrl = entry.url
    if (newer(entry.version, version)) {
      entry.url = url
      entry.version = version ? { created_at: version.created_at, id: version.id } : entry.version
      entry.model.update({ pk: entry.key, picture: url, pending })
    }
    if (previousUrl !== entry.url) rejectIfAllFailed(sources.get(previousUrl))
    const source = load(entry.url, { manual })
    if (source?.ready) present(entry, source)
    else if (source?.status === 'failed') entry.model.reject({ pk: entry.key, url: entry.url })
    publish(entry)
    trim(); pump()
  }
  return {
    snapshot (key) { return entries.get(key)?.snapshot ?? null },
    drawable (key) {
      const entry = entries.get(key)
      return sources.get(entry?.visual?.displayed?.url)?.drawable ?? null
    },
    retain (key, { url, pending, version } = {}) {
      if (closed) return { release () {} }
      let entry = entries.get(key)
      if (!entry) {
        entry = { key, consumers: new Set(), deadline: now() + getAvatarInitialTimeout(), attemptTimeout: getAvatarAttemptTimeout(), url: null, version: null, used: now(), model: null, visual: null }
        entries.set(key, entry)
      }
      const consumer = {}
      entry.consumers.add(consumer)
      entry.used = now()
      if (!entry.model) {
        entry.model = createAvatarPresentation({ timeout: Math.max(0, entry.deadline - now()), onChange: state => { entry.visual = state; publish(entry) } })
        const seed = entry.visual ? { ...entry.visual, initial: entry.visual.initial && now() < entry.deadline } : null
        entry.model.start(key, seed)
      }
      apply(entry, { url, pending, version }, true)
      return {
        update (options) { if (entry.consumers.has(consumer)) apply(entry, options) },
        reject (value) { if (entry.consumers.has(consumer)) rejectCandidate(entry, value, consumer) },
        release () {
          entry.consumers.delete(consumer)
          if (!entry.consumers.size) { entry.model?.close(); entry.model = null; entry.used = now() }
          rejectIfAllFailed(sources.get(entry.url))
          trim(); pump()
        }
      }
    },
    confirm (key, value, image) {
      const entry = entries.get(key)
      const source = sources.get(value.url)
      if (closed || value.pk !== key || !entry?.model || entry.url !== value.url || source?.token !== value.id || source.image?.source !== value.src) return
      source.ready = true
      clearTimeout(source.retryTimer); source.retryTimer = null
      if (!isDataAvatarPicture(value.src)) source.drawable = image
      for (const other of entries.values()) if (other.url === source.url && other.model) { present(other, source); publish(other) }
      trim()
    },
    reject (key, value) {
      rejectCandidate(entries.get(key), value)
    },
    stats () {
      return { active, entries: entries.size, sources: sources.size, idleBytes: [...sources.values()].filter(source => !pinned(source.url)).reduce((total, source) => total + (source.bytes || 0), 0) }
    },
    close () {
      closed = true; stopOnline()
      for (const entry of entries.values()) entry.model?.close()
      for (const source of sources.values()) { source.controller?.abort(); clearTimeout(source.retryTimer) }
      entries.clear(); sources.clear()
    }
  }
}

let service
const bindings = new Set()
export function attachAvatars (next) {
  service = next
  for (const binding of bindings) binding.attach()
  return () => {
    if (service !== next) return
    service = null
    for (const binding of bindings) { binding.handle?.release(); binding.handle = null }
  }
}
export function observeAvatar (key, options) {
  const binding = { handle: null, options, attach () { this.handle?.release(); this.handle = service?.retain(key, this.options) } }
  bindings.add(binding); binding.attach()
  return {
    update (options) { binding.options = options; binding.handle?.update(options) },
    reject (value) { binding.handle?.reject(value) },
    release () { bindings.delete(binding); binding.handle?.release(); binding.handle = null }
  }
}
