const TYPES = new Set(['success', 'error', 'warning', 'info'])

export function normalizeToast (entry) {
  return {
    type: TYPES.has(entry?.type) ? entry.type : 'info',
    message: entry?.message ?? '',
    longMessage: entry?.longMessage ?? '',
    dismissible: entry?.dismissible !== false
  }
}

// Persistent notices have their own lifetimes, independent of the transient
// queue. A key preserves the DOM identity; a token fences obsolete publishers.
export function createPersistentToasts ({ onChange }) {
  let entries = []
  let nextId = 0
  let nextToken = 0
  const emit = () => onChange(entries)
  const remove = id => { entries = entries.filter(entry => entry.id !== id); emit() }
  return {
    show (input) {
      const key = input?.key ?? null
      const previous = key === null ? null : entries.find(entry => entry.key === key)
      const token = ++nextToken
      const entry = { ...normalizeToast(input), key, token, id: previous?.id ?? ++nextId, revision: (previous?.revision ?? 0) + 1 }
      entries = previous ? entries.map(item => item === previous ? entry : item) : [...entries, entry]
      emit()
      const current = () => entries.find(item => item.id === entry.id && item.token === token)
      return {
        update (change) {
          const previous = current()
          if (!previous) return
          const normalized = normalizeToast({ ...previous, ...change })
          if (Object.keys(normalized).every(key => previous[key] === normalized[key])) return
          entries = entries.map(item => item === previous ? { ...previous, ...normalized, revision: previous.revision + 1 } : item)
          emit()
        },
        close () { if (current()) remove(entry.id) }
      }
    },
    dismiss (id) { if (entries.find(entry => entry.id === id)?.dismissible) remove(id) },
    clear () { entries = []; emit() }
  }
}
