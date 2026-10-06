// Account availability is informational. Never infer lock/permissions from an
// operation error, internet connectivity, or unknown/null account flags.
export function createAccountNotice ({ show, messages }) {
  let owner
  let reason
  let notice
  let closed = false
  const clear = () => { notice?.close(); notice = null; reason = null }
  return {
    update (pubkey, state) {
      if (closed) return
      if (owner !== pubkey) { clear(); owner = pubkey }
      if (!/^[0-9a-f]{64}$/.test(owner || '') || state?.pubkey !== owner || state.connection !== 'connected' || state.access !== 'allowed') return
      const next = state.isReadOnly === true ? 'readonly' : state.isLocked === true ? 'locked' : undefined
      if (!next) {
        if (state.isReadOnly === false && state.isLocked === false) clear()
        return
      }
      if (next === reason) return
      const entry = { key: `account:${owner}`, persistent: true, dismissible: false, type: 'warning', message: messages[next] }
      if (notice) notice.update(entry)
      else notice = show(entry)
      reason = next
    },
    close () { closed = true; clear() }
  }
}
