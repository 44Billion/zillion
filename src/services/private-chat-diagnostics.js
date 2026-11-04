const scalarFields = ['name', 'message', 'code', 'category', 'closeCode', 'closeReason', 'wasClean', 'relay', 'operation', 'phase', 'eventId', 'eventKind', 'receivedEventCount', 'elapsedMs', 'stage', 'channelPubkey', 'senderPubkey', 'receiverPubkey', 'ownContentPubkey', 'peerContentPubkey', 'hasOwnContentKey', 'expectedCancellation', 'suppressedCount']
const pick = (value, fields) => Object.fromEntries(fields.filter(key => ['string', 'number', 'boolean'].includes(typeof value?.[key])).map(key => [key, value[key]]))
const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined
const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value) ? value : undefined

function capacitySummary (summary) {
  if (!summary || typeof summary !== 'object') return undefined
  const result = pick(summary, ['count', 'bytes', 'channelCount'])
  if (Array.isArray(summary.buckets)) {
    result.buckets = summary.buckets.slice(0, 32).flatMap(bucket => {
      if (!bucket || typeof bucket !== 'object') return []
      const type = ['message', 'ask', 'reply', 'tell', 'yell', 'nym', 'other'].includes(bucket.type) ? bucket.type : null
      const ageBucket = ['<1h', '1-24h', '1-7d', '>7d', 'unknown'].includes(bucket.ageBucket) ? bucket.ageBucket : null
      const count = safeCount(bucket.count)
      const bytes = safeCount(bucket.bytes)
      return type && ageBucket && count !== undefined && bytes !== undefined ? [{ type, ageBucket, count, bytes }] : []
    })
  }
  if (Array.isArray(summary.codes)) {
    result.codes = summary.codes.slice(0, 32).flatMap(value => {
      if (!value || typeof value !== 'object') return []
      const type = ['message', 'ask', 'reply', 'tell', 'yell', 'nym', 'other'].includes(value.type) ? value.type : null
      const code = safeCode(value.code)
      const count = safeCount(value.count)
      const bytes = safeCount(value.bytes)
      return type && code && count !== undefined && bytes !== undefined ? [{ type, code, count, bytes }] : []
    })
  }
  return result
}

// Error.message/cause/AggregateError.errors are not enumerable. Explicitly
// select diagnostics so copying a console line preserves nested causes without
// serializing messenger results, plaintext events or deletion capabilities.
export function privateChatDiagnostic (error, owner) {
  const seen = new WeakSet()
  function summarize (value, depth = 0) {
    if (value == null || typeof value !== 'object') return { message: String(value) }
    if (seen.has(value)) return { truncated: 'circular' }
    if (depth >= 8) return { truncated: 'depth' }
    seen.add(value)
    const result = pick(value, scalarFields)
    if (Array.isArray(value.pauseReasons)) result.pauseReasons = value.pauseReasons.filter(reason => typeof reason === 'string')
    if (typeof value.reason === 'string') result.reason = value.reason
    const summary = capacitySummary(value.summary)
    if (summary) result.summary = summary
    if (value.cause !== undefined) result.cause = summarize(value.cause, depth + 1)
    if (Array.isArray(value.errors)) result.errors = value.errors.map(item => summarize(item, depth + 1))
    if (value.request) {
      result.request = pick(value.request, ['receiverPubkey', 'since', 'until', 'limit', 'timeoutMs'])
      for (const key of ['relays', 'channelPubkeys']) {
        if (Array.isArray(value.request[key])) result.request[key] = value.request[key].filter(item => typeof item === 'string')
      }
    }
    for (const key of ['relays', 'relayErrors', 'reports']) {
      if (!Array.isArray(value[key])) continue
      result[key] = value[key].map(entry => {
        const report = pick(entry, ['relay', 'status', 'index', 'total', 'fulfilled'])
        for (const field of ['error', 'reason']) {
          if (entry?.[field] !== undefined) report[field] = summarize(entry[field], depth + 1)
        }
        if (Array.isArray(entry?.errors)) report.errors = entry.errors.map(({ relay, reason }) => ({ relay, reason: summarize(reason, depth + 1) }))
        return report
      })
    }
    seen.delete(value)
    return result
  }
  return { owner, ...summarize(error) }
}
