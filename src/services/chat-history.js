// Wrapper-index pagination is independent of the inner event's presentation order.
export const CHAT_PAGE_SIZE = 50
export function createChatWorkers (concurrency = 4) {
  let running = 0
  const queue = []
  function drain () {
    while (running < concurrency && queue.length) {
      const { work, resolve, reject } = queue.shift()
      running++
      Promise.resolve().then(work).then(resolve, reject).finally(() => { running--; drain() })
    }
  }
  return work => new Promise((resolve, reject) => { queue.push({ work, resolve, reject }); drain() })
}

export function createChatHistory ({ eventStore, filter, accept, retained = new Map(), workers = createChatWorkers(), onMissing, onBatch, onState, onError }) {
  let closed = false
  let stream
  let frontier = null
  let boundary = new Set()
  let hasOlder = true
  let older
  let ready = false
  let frame
  let initial
  const pending = new Map()
  const state = (loading = false, error = null) => { if (!closed) onState({ loading, error, hasOlder }) }
  const batch = () => { if (!closed) onBatch() }
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
  function process (wrapper) {
    if (closed || retained.has(wrapper.id)) return Promise.resolve()
    if (pending.has(wrapper.id)) return pending.get(wrapper.id)
    const work = workers(async () => {
      if (closed) return
      const innerId = await accept(wrapper, () => !closed)
      if (!closed) retained.set(wrapper.id, { innerId, created_at: wrapper.created_at })
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
    // pages may be separated from it by more than 50 newly received wrappers.
  }
  async function start () {
    initial = Promise.withResolvers()
    stream = eventStore.subscribe({ ...filter, limit: CHAT_PAGE_SIZE }, { initial: true })
    // The live iterator is registered before revalidation to avoid a recovery gap.
    const recovery = revalidate()
    ;(async () => {
      const snapshot = []
      try {
        for await (const item of stream) {
          if (closed) return
          if (item.type === 'eose' && !ready) {
            await recovery
            await processPage(snapshot)
            if (closed) return
            advance(snapshot)
            hasOlder = snapshot.length === CHAT_PAGE_SIZE
            snapshot.length = 0
            ready = true
            batch(); state(); initial.resolve(true)
          } else if (item.type === 'event') {
            if (!ready) snapshot.push(item.event)
            else if (frontier !== null && item.event.created_at < frontier) { hasOlder = true; state(!!older) } else process(item.event).then(schedule, error => { if (!closed) onError(error) })
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
  return {
    start, loadOlder,
    close () {
      closed = true
      initial?.resolve(false)
      if (frame != null) (globalThis.cancelAnimationFrame ?? clearTimeout)(frame)
      stream?.return().catch(() => {})
    }
  }
}
