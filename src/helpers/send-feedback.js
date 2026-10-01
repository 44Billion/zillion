// This controller belongs to one mounted route. Failures are live events, never
// replayed from persisted message state when a chat opens or becomes active.
export function createSendFeedback ({ isActive, peer, notify }) {
  const pending = new Set()
  const failed = (error, attempt) => {
    if (attempt.peer !== peer() || !pending.delete(attempt.id)) return
    if (isActive()) notify(error)
  }
  return {
    failed,
    send (work) {
      if (!isActive()) return
      try {
        const id = work()
        if (id) pending.add(id)
        return id
      } catch (error) { if (isActive()) notify(error) }
    },
    async retry (id, work) {
      if (!isActive()) return
      pending.add(id)
      const recipient = peer()
      try { return await work() } catch (error) { failed(error, { id, peer: recipient }) }
    },
    reconcile (messages) {
      const active = new Set(messages.filter(message => message.status === 'pending' || message.status === 'error').map(message => message.id))
      for (const id of pending) if (!active.has(id)) pending.delete(id)
    },
    clear () { pending.clear() }
  }
}
