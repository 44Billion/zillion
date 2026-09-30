// One speculative conversation at a time. Opened histories belong to the app;
// only unvisited background histories participate in this small LRU budget.
export function createConversationPrefetch ({ load, release, isOpened, isPinned = () => false, capacity = 12 }) {
  const entries = new Map()
  let wanted = []
  let active
  let closed = false
  function trim () {
    for (const peer of entries.keys()) if (isOpened(peer)) entries.delete(peer)
    const candidates = [...entries.keys()].filter(peer => !isPinned(peer))
    let excess = candidates.length - capacity
    for (const peer of candidates) {
      if (excess <= 0) break
      if (wanted.includes(peer) || active?.peer === peer) continue
      entries.delete(peer); release(peer); excess--
    }
  }
  function pump () {
    if (closed || active) return
    const peer = wanted.find(peer => !isOpened(peer) && !entries.get(peer)?.done)
    if (!peer) return
    const controller = new AbortController()
    const entry = entries.get(peer)
    const job = active = { peer, controller }
    Promise.resolve().then(() => load(peer, controller.signal)).catch(() => false).then(() => {
      if (!closed && !controller.signal.aborted && entries.get(peer) === entry) entry.done = true
    }).finally(() => { if (active === job) active = null; trim(); pump() })
  }
  function stopUnwanted () {
    if (active && !wanted.includes(active.peer) && !isOpened(active.peer)) active.controller.abort()
  }
  return {
    setVisible (peers) {
      if (closed) return
      wanted = [...new Set(peers)]
      for (const peer of wanted) {
        if (isOpened(peer)) continue
        const entry = entries.get(peer) || { done: false }
        entries.delete(peer); entries.set(peer, entry)
      }
      stopUnwanted(); trim(); pump()
    },
    focus () { wanted = []; stopUnwanted(); trim() },
    reset () { wanted = []; stopUnwanted(); for (const entry of entries.values()) entry.done = false },
    close () { closed = true; wanted = []; active?.controller.abort(); entries.clear() }
  }
}
