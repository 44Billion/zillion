import { isOnline } from 'libp2r2p/network'
import { PERSONAL_COPY } from 'libp2r2p/kind'

const MAX_HEAD_BYTES = 256 * 1024
const MAX_CACHE_ENTRIES = 128

export function safePreviewUrl (value, base) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value, base)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function parsePreviewHead (html, url) {
  // Template contents stay inert: scripts, frames and images from the page never mount.
  const template = document.createElement('template')
  template.innerHTML = html
  const head = template.content
  const meta = name => [...head.querySelectorAll('meta')].find(el => (el.getAttribute('property') || el.getAttribute('name'))?.toLowerCase() === name)?.getAttribute('content')?.trim().slice(0, 2000) || ''
  const icon = [...head.querySelectorAll('link[href]')].find(el => /(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(el.getAttribute('rel') || ''))
  return {
    title: meta('og:title'), description: meta('og:description'),
    site: meta('og:site_name') || new URL(url).hostname,
    image: safePreviewUrl(meta('og:image'), url),
    icon: safePreviewUrl(icon?.getAttribute('href'), url) || new URL('/favicon.ico', url).href
  }
}

async function readHead (response, signal) {
  if (!response.ok || !/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel()
    throw new Error('Preview unavailable')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let html = ''
  let bytes = 0
  try {
    while (bytes < MAX_HEAD_BYTES) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      html += decoder.decode(value.subarray(0, MAX_HEAD_BYTES - bytes), { stream: true })
      bytes += value.byteLength
      const end = html.search(/<\/head\s*>/i)
      if (end >= 0) return html.slice(0, end)
    }
    return html + decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function createLinkPreviews ({ fetchPage = (...args) => fetch(...args), checkOnline = isOnline, parse = parsePreviewHead } = {}) {
  const cache = new Map()
  let active = 0
  const waiting = new Set()
  async function acquire (signal) {
    if (active < 4) { active++; return }
    if (waiting.size >= 128) throw new Error('Preview queue full')
    await new Promise((resolve, reject) => {
      const next = () => { signal.removeEventListener('abort', abort); resolve() }
      const abort = () => { waiting.delete(next); reject(signal.reason) }
      waiting.add(next)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
  function release () {
    const next = waiting.values().next().value
    if (next) { waiting.delete(next); next() } else active--
  }
  return {
    async load (input, { signal } = {}) {
      const url = safePreviewUrl(input)
      if (!url) return null
      const cached = cache.get(url)
      if (cached && cached.until > Date.now()) return cached.value
      if (!await checkOnline({ signal }).catch(() => false)) return null
      const requestSignal = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])])
      const fallback = { icon: new URL('/favicon.ico', url).href, site: new URL(url).hostname }
      let acquired = false
      try {
        requestSignal.throwIfAborted()
        await acquire(requestSignal)
        acquired = true
        // Another queued request may already have populated this URL.
        const shared = cache.get(url)
        if (shared && shared.until > Date.now()) return shared.value
        const response = await fetchPage(url, { signal: requestSignal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
        const html = await readHead(response, requestSignal)
        const value = { ...parse(html, safePreviewUrl(response.url) || url), found: true }
        cache.set(url, { value, until: Date.now() + 5 * 60000 })
        return value
      } catch {
        if (!signal?.aborted) cache.set(url, { value: fallback, until: Date.now() + 60000 })
        return signal?.aborted ? null : fallback
      } finally {
        if (acquired) release()
        while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
      }
    }
  }
}

// Query local provenance before disclosing an event pointer to an external site.
// An unreadable store is not evidence that a reference is public.
export async function canPreviewNostrReference (reference, { knownMessages = [], eventStore, signer, owner }) {
  if (reference.kind === PERSONAL_COPY || knownMessages.some(message => message.id === reference.id)) return false
  if (!owner || !eventStore || !signer) return false
  try {
    if (reference.id) {
      const { results: exact } = await eventStore.query({ kinds: [PERSONAL_COPY], authors: [owner], ids: [reference.id], limit: 1 })
      if (exact.some(event => event.kind === PERSONAL_COPY)) return false
      const mirror = await signer.obfuscate(reference.id, String(PERSONAL_COPY), '.id')
      const { results } = await eventStore.query({ kinds: [PERSONAL_COPY], authors: [owner], '#o': [mirror], limit: 1 })
      if (results.length) return false
    } else if (reference.pubkey && Number.isInteger(reference.kind)) {
      // Address mirrors are not indexed as coordinates. Conservatively keep
      // addresses local when copies of this author's kind exist, without a scan.
      const mirror = await signer.obfuscate(reference.pubkey, String(PERSONAL_COPY), '.pubkey')
      const { results } = await eventStore.query({ kinds: [PERSONAL_COPY], authors: [owner], '#k': [String(reference.kind)], '#o': [mirror], limit: 1 })
      if (results.length) return false
    }
    return true
  } catch { return false }
}

export default createLinkPreviews()
