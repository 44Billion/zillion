export const INITIAL_CONVERSATION_ORDER_TIMEOUT_MS = 3000

// Freeze only the startup positions. Message readiness and visible prefetch
// remain independent, and ordinary new messages reorder live afterward.
export function createConversationOrder ({ onChange, timeout = INITIAL_CONVERSATION_ORDER_TIMEOUT_MS }) {
  let ids = []
  let started = false
  let live = false
  let closed = false
  let timer
  let cohort
  const emit = () => { if (!closed) onChange({ ids: [...ids], live }) }
  const finish = () => { if (closed || live) return; live = true; clearTimeout(timer); emit() }
  return {
    reconcile (rows, summaries) {
      if (closed) return
      const members = new Set(rows.map(row => row.contact.pubkey))
      ids = ids.filter(id => members.has(id))
      for (const row of rows) if (row.lastMessageAt && !ids.includes(row.contact.pubkey)) ids.push(row.contact.pubkey)
      if (!started) {
        started = true
        cohort = new Set(rows.filter(row => row.lastMessageAt).map(row => row.contact.pubkey))
        timer = setTimeout(finish, timeout)
      }
      const wanted = new Set(rows.map(row => row.contact.pubkey))
      for (const peer of cohort) if (!wanted.has(peer)) cohort.delete(peer)
      emit()
      if ([...cohort].every(peer => summaries[peer]?.messageReady || summaries[peer]?.state === 'unavailable')) finish()
    },
    close () { closed = true; clearTimeout(timer) }
  }
}

export function orderHomeConversations (rows, { ids = [], live = true } = {}) {
  if (live) return rows.toSorted((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
  const rank = new Map(ids.map((id, index) => [id, index]))
  return rows.toSorted((a, b) => Number(!!b.lastMessageAt) - Number(!!a.lastMessageAt) || (rank.get(a.contact.pubkey) ?? Infinity) - (rank.get(b.contact.pubkey) ?? Infinity))
}
