// Wrapper-index pagination is independent of the inner event's presentation order.
import { compareChatMessages } from '#helpers/conversation-preview.js'

export const CHAT_PAGE_SIZE = 25
export function createChatWorkers (concurrency = 4) {
  let running = 0
  const queue = []
  function drain () {
    while (running < concurrency && queue.length) {
      // Priority is read at dispatch, so opening a prefetched chat promotes
      // its already queued work without exceeding the shared concurrency cap.
      let next = 0
      for (let index = 1; index < queue.length; index++) if (queue[index].priority() > queue[next].priority()) next = index
      const { work, resolve, reject } = queue.splice(next, 1)[0]
      running++
      Promise.resolve().then(work).then(resolve, reject).finally(() => { running--; drain() })
    }
  }
  return (work, priority = () => 0) => new Promise((resolve, reject) => { queue.push({ work, priority, resolve, reject }); drain() })
}

export function createChatHistory ({ eventStore, filter, accept, retained = new Map(), workers = createChatWorkers(), onMissing, onBatch, onState, onNewerState = () => {}, onError }) {
  let closed = false
  let stream
  let frontier = null
  let boundary = new Set()
  let hasOlder = true
  let older
  let ready = false
  let frame
  let initial
  // Forward pagination (anchored opens): the ascending cursor of the loaded
  // window, plus the newest timestamp any subscription delivered.
  let forwardTop = null
  let forwardBoundary = new Set()
  let forwardFull = false
  let knownTop = null
  let hasNewer = false
  let newer
  const pending = new Map()
  const state = (loading = false, error = null) => { if (!closed) onState({ loading, error, hasOlder }) }
  const newerState = (loading = false, error = null) => { if (!closed) onNewerState({ loading, error, hasNewer }) }
  const batch = () => {
    if (frame != null) { (globalThis.cancelAnimationFrame ?? clearTimeout)(frame); frame = null }
    if (!closed) onBatch()
  }
  const schedule = () => {
    if (frame != null) return
    const request = globalThis.requestAnimationFrame ?? (fn => setTimeout(fn, 0))
    frame = request(() => { frame = null; batch() })
  }
  function advance (wrappers) {
    for (const wrapper of wrappers) {
      if (!Number.isSafeInteger(wrapper.created_at)) continue
      if (frontier === null || wrapper.created_at < frontier) { frontier = wrapper.created_at; boundary = new Set() }
      if (wrapper.created_at === frontier) boundary.add(wrapper.id)
    }
  }
  function advanceKnown (wrappers) {
    for (const wrapper of wrappers) {
      if (!Number.isSafeInteger(wrapper.created_at)) continue
      if (knownTop === null || wrapper.created_at > knownTop) knownTop = wrapper.created_at
    }
  }
  function advanceForward (wrappers) {
    for (const wrapper of wrappers) {
      if (!Number.isSafeInteger(wrapper.created_at)) continue
      if (forwardTop === null || wrapper.created_at > forwardTop) { forwardTop = wrapper.created_at; forwardBoundary = new Set() }
      if (wrapper.created_at === forwardTop) forwardBoundary.add(wrapper.id)
    }
  }
  function refreshNewer () {
    hasNewer = forwardTop !== null && (forwardFull || (knownTop !== null && knownTop > forwardTop))
    newerState()
  }
  function process (wrapper) {
    if (closed || retained.has(wrapper.id)) return Promise.resolve()
    if (pending.has(wrapper.id)) return pending.get(wrapper.id)
    const work = workers(async () => {
      if (closed) return
      const innerId = await accept(wrapper, () => !closed)
      if (!closed) {
        retained.set(wrapper.id, { innerId, created_at: wrapper.created_at })
        schedule()
      }
    }).finally(() => pending.delete(wrapper.id))
    pending.set(wrapper.id, work)
    return work
  }
  async function processPage (wrappers) {
    const results = await Promise.allSettled(wrappers.map(process))
    const failed = results.find(result => result.status === 'rejected')
    if (failed) throw failed.reason
  }
  async function revalidate () {
    const ids = [...retained.keys()]
    const copies = new Map()
    for (const { innerId } of retained.values()) {
      if (innerId) copies.set(innerId, (copies.get(innerId) ?? 0) + 1)
    }
    for (let offset = 0; offset < ids.length; offset += CHAT_PAGE_SIZE) {
      if (closed) return
      const page = ids.slice(offset, offset + CHAT_PAGE_SIZE)
      const { results } = await eventStore.query({ ...filter, ids: page, limit: CHAT_PAGE_SIZE, ids_only: true })
      if (closed) return
      const present = new Set(results)
      for (const id of page) {
        if (!present.has(id)) {
          const { innerId } = retained.get(id) ?? {}
          retained.delete(id)
          if (innerId) {
            copies.set(innerId, copies.get(innerId) - 1)
            if (copies.get(innerId) === 0) onMissing(innerId)
          }
        }
      }
    }
    // Restart pagination at the recent snapshot after recovery. Retained older
    // pages may be separated from it by more than one page of newly received wrappers.
  }
  // Ascending page from the forward cursor. `accept` filters wrappers that
  // belong before the anchor; retained duplicates still advance the cursor.
  async function fetchForward (limit, accept = null) {
    const page = []
    let exhausted = false
    for (let rounds = 0; rounds < 12 && page.length < limit && !exhausted; rounds++) {
      const want = limit - page.length
      const { results } = await eventStore.query({
        ...filter,
        ...(forwardTop === null ? {} : { since: forwardTop, ...(forwardBoundary.size ? { '!ids': [...forwardBoundary] } : {}) }),
        limit: want,
        search: 'sort:asc'
      })
      if (closed) return { page, exhausted: true }
      if (!results.length) { exhausted = true; break }
      advanceKnown(results)
      advanceForward(results)
      for (const wrapper of results) {
        if (accept && !accept(wrapper)) continue
        if (!retained.has(wrapper.id)) page.push(wrapper)
      }
      if (results.length < want) exhausted = true
    }
    forwardFull = !exhausted && page.length >= limit
    return { page, exhausted }
  }

  async function start ({ anchor = null } = {}) {
    initial = Promise.withResolvers()
    stream = eventStore.subscribe({ ...filter, limit: CHAT_PAGE_SIZE }, { initial: true })
    // The live iterator is registered before revalidation to avoid a recovery gap.
    const recovery = revalidate()
    ;(async () => {
      const snapshot = []
      const processing = []
      try {
        for await (const item of stream) {
          if (closed) return
          if (item.type === 'eose' && !ready) {
            await recovery
            const results = await Promise.all(processing)
            const failed = results.find(Boolean)
            if (failed) throw failed.error
            if (closed) return
            advanceKnown(snapshot)
            const hasUnread = anchor !== null && Number.isSafeInteger(anchor?.created_at) && snapshot.some(wrapper => compareChatMessages(wrapper, anchor) > 0)
            const anchorInside = hasUnread && snapshot.some(wrapper => compareChatMessages(wrapper, anchor) <= 0)
            let anchored = false
            if (hasUnread && !anchorInside) {
              // The newest page is already decrypted and retained; this adds the
              // window that begins at the first unread message. The remaining
              // gap is filled by loadNewer() as the reader scrolls forward.
              forwardTop = anchor.created_at
              forwardBoundary = new Set()
              try {
                const { page } = await fetchForward(CHAT_PAGE_SIZE, wrapper => compareChatMessages(wrapper, anchor) > 0)
                if (closed) return
                if (page.length) {
                  await processPage(page)
                  if (closed) return
                  advance(page)
                  hasOlder = true
                  anchored = true
                }
              } catch { /* The recent page stays usable when the anchor read fails. */ }
            }
            if (!anchored) {
              advance(snapshot)
              hasOlder = snapshot.length === CHAT_PAGE_SIZE
              forwardTop = null
              forwardBoundary = new Set()
              forwardFull = false
            }
            refreshNewer()
            snapshot.length = 0
            processing.length = 0
            ready = true
            batch(); state(); initial.resolve(true)
          } else if (item.type === 'event') {
            if (!ready) {
              snapshot.push(item.event)
              // Revalidate retained IDs first, then decrypt as each copy arrives.
              // Observe failures immediately even if EOSE has not arrived yet.
              processing.push(recovery.then(() => process(item.event)).then(() => null, error => {
                initial.reject(error)
                return { error }
              }))
            } else if (frontier !== null && item.event.created_at < frontier) { hasOlder = true; state(!!older) } else {
              advanceKnown([item.event])
              process(item.event).catch(error => { if (!closed) onError(error) })
            }
          }
        }
        if (!closed) throw new Error('Self chat subscription ended')
      } catch (error) { initial.reject(error); if (ready && !closed) onError(error) } finally { if (closed) initial.resolve(false) }
    })()
    // Observe recovery failure immediately, including while snapshot delivery stalls.
    recovery.catch(error => { initial.reject(error) })
    return initial.promise
  }
  function loadOlder () {
    if (closed || !ready || !hasOlder) return Promise.resolve(false)
    if (older) return older
    state(true)
    older = (async () => {
      try {
        const cursor = frontier === null ? {} : { until: frontier, '!ids': [...boundary] }
        const { results } = await eventStore.query({ ...filter, ...cursor, limit: CHAT_PAGE_SIZE })
        if (closed) return false
        await processPage(results)
        if (closed) return false
        advance(results)
        hasOlder = results.length === CHAT_PAGE_SIZE
        batch(); state(); return true
      } catch (error) { if (!closed) { batch(); state(false, error.message || String(error)) }; return false } finally { older = null }
    })()
    return older
  }
  function loadNewer () {
    if (closed || !ready || !hasNewer) return Promise.resolve(false)
    if (newer) return newer
    newerState(true)
    newer = (async () => {
      try {
        const { page } = await fetchForward(CHAT_PAGE_SIZE)
        if (closed) return false
        await processPage(page)
        if (closed) return false
        refreshNewer()
        batch(); newerState(); return page.length > 0
      } catch (error) { if (!closed) { batch(); newerState(false, error.message || String(error)) }; return false } finally { newer = null }
    })()
    return newer
  }
  return {
    start, loadOlder, loadNewer,
    close () {
      closed = true
      initial?.resolve(false)
      if (frame != null) (globalThis.cancelAnimationFrame ?? clearTimeout)(frame)
      stream?.return().catch(() => {})
    }
  }
}
