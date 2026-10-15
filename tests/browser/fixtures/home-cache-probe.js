import { createConversationSummaryCache as createCache } from '#services/conversation-summary-cache.js'

// Observe the real encrypted cache and signer without changing their results.
export function createConversationSummaryCache (options) {
  const cache = createCache(options)
  return {
    ...cache,
    async read () {
      const boot = window.contactBoot
      boot.cacheReads = (boot.cacheReads || 0) + 1
      boot.cacheStarted = performance.now() - boot.started
      const records = await cache.read()
      boot.cacheFinished = performance.now() - boot.started
      return records
    }
  }
}
