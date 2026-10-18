const enabled = typeof IS_DEVELOPMENT !== 'undefined' && IS_DEVELOPMENT
const traces = new Map()

export function recordMessagingPerformance (entry) {
  if (!enabled) return
  const value = Object.fromEntries(['stage', 'eventId', 'at', 'elapsedMs'].filter(key => entry[key] !== undefined).map(key => [key, entry[key]]))
  if (!value.eventId) return
  const trace = traces.get(value.eventId) ?? []
  trace.push(value)
  if (trace.length > 32) trace.shift()
  traces.delete(value.eventId); traces.set(value.eventId, trace)
  if (traces.size > 128) traces.delete(traces.keys().next().value)
  if (entry.stage === 'bubble-saved') {
    console.groupCollapsed(`[messaging-performance] ${value.eventId}`)
    console.table(trace)
    console.groupEnd()
  } else console.debug(`[messaging-performance] ${JSON.stringify(value)}`)
}
