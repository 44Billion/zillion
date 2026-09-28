const scalarFields = ['name', 'message', 'code', 'category', 'closeCode', 'closeReason', 'wasClean', 'relay', 'operation', 'eventId', 'eventKind', 'receivedEventCount', 'elapsedMs']
const pick = (value, fields) => Object.fromEntries(fields.filter(key => ['string', 'number', 'boolean'].includes(typeof value?.[key])).map(key => [key, value[key]]))

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
    if (typeof value.reason === 'string') result.reason = value.reason
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
