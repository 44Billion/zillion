import { getHomeCacheTimeout, INITIAL_HOME_CACHE_TIMEOUT_MS } from '#helpers/home-cache.js'

export const INITIAL_CONTACT_ORDER_TIMEOUT_MS = 30000
export const INITIAL_CONTACT_CACHE_TIMEOUT_MS = INITIAL_HOME_CACHE_TIMEOUT_MS

// One local name snapshot seeds a stable order before the first peer paint.
// Profile interests belong to the shared coordinator, including remote recovery.
export function createContactOrder ({ initialReady, localReady, nameFor, self, onChange, timeout = INITIAL_CONTACT_ORDER_TIMEOUT_MS, localTimeout = getHomeCacheTimeout() }) {
  let ids = []
  let started = false
  let alphabetical = false
  let closed = false
  let timer
  let localTimer
  let localPending = false
  let cohort = []
  let contactsById = new Map()
  let hydratedIds = []
  let cacheSeeded = false
  const pending = new Map()
  const localReads = new Set()
  const localProfiles = new Map()
  const emit = () => { if (!closed) onChange({ ids: [...ids], alphabetical, localPending }) }
  const finish = () => {
    if (closed || alphabetical) return
    alphabetical = true
    localPending = false
    clearTimeout(timer)
    clearTimeout(localTimer)
    pending.clear()
    localReads.clear()
    localProfiles.clear()
    emit()
  }
  const check = () => { if (started && !localPending && !pending.size) finish() }
  const applyHydrated = () => {
    if (!cacheSeeded) return
    const members = new Set(ids)
    const next = hydratedIds.filter(id => members.has(id))
    const seen = new Set(next)
    for (const id of ids) if (!seen.has(id)) next.push(id)
    ids = next
  }
  const finishLocal = () => {
    if (closed || !localPending) return
    localPending = false
    clearTimeout(localTimer)
    const members = new Set(ids)
    const people = cohort.filter(person => members.has(person.id)).map(person => ({ ...person, name: nameFor(person.pubkey, localProfiles.get(person.id), contactsById.get(person.id)) }))
    const seeded = new Set(people.map(person => person.id))
    ids = [...orderHomeContacts(people, { alphabetical: true }).map(person => person.id), ...ids.filter(id => !seeded.has(id))]
    localReads.clear()
    localProfiles.clear()
    emit()
    check()
  }
  return {
    reconcile (contacts, { start = true } = {}) {
      if (closed) return
      contactsById = new Map(contacts.map(contact => [contact.pubkey, contact]))
      const members = new Set(contacts.map(contact => contact.pubkey))
      if (self) members.add(self.id)
      ids = ids.filter(id => members.has(id))
      const seen = new Set(ids)
      for (const contact of contacts) if (!seen.has(contact.pubkey)) { ids.push(contact.pubkey); seen.add(contact.pubkey) }
      if (self && !seen.has(self.id)) ids.push(self.id)
      applyHydrated()
      for (const [id] of pending) {
        if (!members.has(id) || contacts.some(contact => contact.pubkey === id && contact.petname)) pending.delete(id)
      }
      for (const id of localReads) if (!members.has(id) || contactsById.get(id)?.petname) localReads.delete(id)
      if (!started && start && contacts.length) {
        started = true
        timer = setTimeout(finish, timeout)
        if (localReady && !cacheSeeded) {
          localPending = true
          cohort = [...contacts.map(contact => ({ id: contact.pubkey, pubkey: contact.pubkey })), ...(self ? [self] : [])]
          localTimer = setTimeout(finishLocal, localTimeout)
          for (const person of cohort) localReads.add(person.id)
          for (const person of cohort) {
            const settle = profile => {
              if (closed || !localPending || !localReads.delete(person.id)) return
              localProfiles.set(person.id, profile)
              if (!localReads.size) finishLocal()
            }
            Promise.resolve().then(() => contactsById.get(person.id)?.petname ? null : localReady(person.pubkey)).then(settle, () => settle(null))
          }
        }
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
      if (localPending && !localReads.size) finishLocal()
      check()
    },
    hydrate (values) {
      if (closed || !Array.isArray(values)) return
      const next = []
      const seen = new Set()
      for (const id of values) {
        if (id !== 'user' && !/^[0-9a-f]{64}$/.test(id || '')) continue
        if (seen.has(id)) continue
        seen.add(id); next.push(id)
        if (next.length === 512) break
      }
      hydratedIds = next
      if (!next.length) return
      cacheSeeded = true
      localPending = false
      clearTimeout(localTimer)
      localReads.clear()
      localProfiles.clear()
      applyHydrated()
      emit()
      check()
    },
    close () { closed = true; clearTimeout(timer); clearTimeout(localTimer); pending.clear(); localReads.clear(); localProfiles.clear(); contactsById.clear(); cohort = [] }
  }
}

export function orderHomeContacts (people, { ids = [], alphabetical = false, localPending = false } = {}) {
  if (localPending) return people.filter(person => person.self)
  const rank = new Map(ids.map((id, index) => [id, index]))
  return people.toSorted((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (alphabetical
    ? a.name.localeCompare(b.name, 'en')
    : (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)))
}
