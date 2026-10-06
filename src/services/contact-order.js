export const INITIAL_CONTACT_ORDER_TIMEOUT_MS = 30000

// Account-owned arrival order and one finite startup cohort. Profile interests
// belong to the shared coordinator; this gate only observes their readiness.
export function createContactOrder ({ initialReady, onChange, timeout = INITIAL_CONTACT_ORDER_TIMEOUT_MS }) {
  let ids = []
  let started = false
  let alphabetical = false
  let closed = false
  let timer
  const pending = new Map()
  const emit = () => { if (!closed) onChange({ ids: [...ids], alphabetical }) }
  const finish = () => {
    if (closed || alphabetical) return
    alphabetical = true
    clearTimeout(timer)
    pending.clear()
    emit()
  }
  const check = () => { if (started && !pending.size) finish() }
  return {
    reconcile (contacts, { start = true } = {}) {
      if (closed) return
      const members = new Set(contacts.map(contact => contact.pubkey))
      ids = ids.filter(id => members.has(id))
      const seen = new Set(ids)
      for (const contact of contacts) if (!seen.has(contact.pubkey)) { ids.push(contact.pubkey); seen.add(contact.pubkey) }
      for (const [id] of pending) {
        if (!members.has(id) || contacts.some(contact => contact.pubkey === id && contact.petname)) pending.delete(id)
      }
      if (!started && start && ids.length) {
        started = true
        timer = setTimeout(finish, timeout)
        for (const contact of contacts) {
          if (contact.petname || pending.has(contact.pubkey)) continue
          const token = {}
          pending.set(contact.pubkey, token)
          const settle = () => {
            if (closed || pending.get(contact.pubkey) !== token) return
            pending.delete(contact.pubkey)
            check()
          }
          Promise.resolve().then(() => initialReady(contact.pubkey)).then(settle, settle)
        }
      }
      emit()
      check()
    },
    close () { closed = true; clearTimeout(timer); pending.clear() }
  }
}

export function orderHomeContacts (people, { ids = [], alphabetical = false } = {}) {
  const rank = new Map(ids.map((id, index) => [id, index]))
  return people.toSorted((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (alphabetical
    ? a.name.localeCompare(b.name, 'en')
    : (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)))
}
