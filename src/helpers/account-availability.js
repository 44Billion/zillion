export function hasContentKeyMethods (signer) {
  return typeof signer?.doubleSignEvent === 'function' &&
    typeof signer?.nip44v3?.encryptDoubleDH === 'function' &&
    typeof signer?.nip44v3?.decryptDoubleDH === 'function'
}

export function isAccountAvailable (state) {
  return state?.access === 'allowed' && state.connection === 'connected' &&
    state.isDefaultUser !== true && state.supportsContentKeyMethods !== false &&
    state.isLocked === false && state.isReadOnly === false
}
