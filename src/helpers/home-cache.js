export const INITIAL_HOME_CACHE_TIMEOUT_MS = 250
const MOBILE_HOME_CACHE_TIMEOUT_MS = 1500

// A maximum bootstrap wait, never a minimum delay for an available cache.
export function getHomeCacheTimeout () {
  return globalThis.matchMedia?.('(max-width: 718px)').matches ? MOBILE_HOME_CACHE_TIMEOUT_MS : INITIAL_HOME_CACHE_TIMEOUT_MS
}
