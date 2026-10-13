import { isAccountAvailable } from '#helpers/account-availability.js'

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
      if (!/^[0-9a-f]{64}$/.test(owner || '') || state?.pubkey !== owner || state.access !== 'allowed') return
      const connected = state.connection === 'connected'
      let next
      if (state.isDefaultUser === true) next = 'signedout'
      else if (connected && state.isReadOnly === true) next = 'readonly'
      else if (state.supportsContentKeyMethods === false) next = 'unsupported'
      else if (connected && state.isLocked === true) next = 'locked'
      if (!next) {
        if (isAccountAvailable(state)) clear()
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
