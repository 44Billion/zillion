const enabled = typeof IS_DEVELOPMENT !== 'undefined' && IS_DEVELOPMENT
let traces
const prefix = '[messaging-performance]'
const sendTraceEvent = 'zillion:send-trace'

const optimisticSendTraceEnabled = () => globalThis.__ZILLION_SEND_TRACE__ === true

function emitOptimisticSendTrace (detail) {
  try {
    if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return
    globalThis.dispatchEvent(new globalThis.CustomEvent(sendTraceEvent, { detail }))
  } catch {}
}

export function recordMessagingPerformance (entry) {
  if (!enabled) return
  const ids = ['stage', 'eventId', 'publicationId', 'seedRecordId', 'requestId', 'parentId', 'reason', 'state']
  const value = Object.fromEntries([...ids, 'at', 'elapsedMs', 'expediteRemainingMs', 'timelineWorkMs', 'messageCount', 'rowCount', 'uniqueCount', 'existingCount', 'insertedCount', 'blockedCount', 'expiredCount', 'storedCount', 'skippedCount'].filter(key => ids.includes(key)
    ? typeof entry[key] === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(entry[key])
    : Number.isFinite(entry[key])).map(key => [key, entry[key]]))
  if (!value.eventId) return
  traces ??= new Map()
  const trace = traces.get(value.eventId) ?? []
  trace.push(value)
  if (trace.length > 32) trace.shift()
  traces.delete(value.eventId); traces.set(value.eventId, trace)
  if (traces.size > 128) traces.delete(traces.keys().next().value)
  console.debug(`${prefix} ${JSON.stringify(value)}`)
  if (entry.stage === 'bubble-saved' && globalThis.__ZILLION_MESSAGING_DETAILS__ === true) {
    console.groupCollapsed(`${prefix} ${value.eventId}`)
    console.table(trace)
    console.groupEnd()
  }
}

export function createOptimisticSendTrace ({
  now = () => performance.now(),
  wallNow = () => Date.now(),
  record = recordMessagingPerformance,
  emit = emitOptimisticSendTrace,
  limit = 32
} = {}) {
  const traces = new Map()
  let serial = 0
  const emitStage = (stage, fields) => emit({ stage, at: wallNow(), ...fields })
  return {
    begin () {
      const trace = { token: `trace-${++serial}`, startedAt: now() }
      emitStage('send-started', { token: trace.token })
      return trace
    },
    pendingQueued (id, startedAt) {
      if (typeof id !== 'string' || !Number.isFinite(startedAt)) return
      const elapsedMs = wallNow() - startedAt
      record({ stage: 'optimistic-pending-queued', eventId: id, elapsedMs })
      emitStage('optimistic-pending-queued', { eventId: id, elapsedMs })
    },
    returned (trace, id) {
      if (typeof id !== 'string' || !Number.isFinite(trace?.startedAt)) return
      if (!traces.has(id) && traces.size >= limit) traces.delete(traces.keys().next().value)
      traces.set(id, trace)
      const elapsedMs = now() - trace.startedAt
      record({ stage: 'send-returned', eventId: id, elapsedMs })
      emitStage('send-returned', { token: trace.token, eventId: id, elapsedMs })
    },
    projected (messages, { workMs, messageCount } = {}) {
      if (!Array.isArray(messages) || !traces.size) return
      const projected = new Set(messages.map(message => message?.id).filter(id => typeof id === 'string'))
      for (const [id, trace] of traces) {
        if (!projected.has(id)) continue
        record({
          stage: 'timeline-projected',
          eventId: id,
          elapsedMs: now() - trace.startedAt,
          timelineWorkMs: workMs,
          messageCount
        })
        emitStage('timeline-projected', {
          token: trace.token,
          eventId: id,
          elapsedMs: now() - trace.startedAt,
          timelineWorkMs: workMs,
          messageCount
        })
        traces.delete(id)
      }
    },
    active () { return traces.size > 0 },
    clear () { traces.clear() }
  }
}

let optimisticSendTrace

export function beginOptimisticSendTrace () {
  if (!optimisticSendTraceEnabled()) return null
  optimisticSendTrace ??= createOptimisticSendTrace()
  return optimisticSendTrace.begin()
}

export function recordOptimisticPendingQueued (id, startedAt) {
  if (!optimisticSendTraceEnabled()) return
  optimisticSendTrace ??= createOptimisticSendTrace()
  optimisticSendTrace.pendingQueued(id, startedAt)
}

export function recordOptimisticSendReturned (trace, id) {
  if (!trace || !optimisticSendTraceEnabled()) return
  optimisticSendTrace ??= createOptimisticSendTrace()
  optimisticSendTrace.returned(trace, id)
}

export function recordOptimisticTimelineProjected (messages, measurements) {
  if (!optimisticSendTraceEnabled()) return
  optimisticSendTrace ??= createOptimisticSendTrace()
  optimisticSendTrace.projected(messages, measurements)
}

export function optimisticSendTraceActive () {
  return optimisticSendTraceEnabled() && optimisticSendTrace?.active() === true
}
