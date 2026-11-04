let traces
const prefix = '[messaging-performance]'
const sendTraceEvent = 'zillion:send-trace'

const developmentEnabled = () => typeof IS_DEVELOPMENT !== 'undefined' && IS_DEVELOPMENT
const productionDiagnosticsEnabled = () => globalThis.__ZILLION_MESSAGING_DIAGNOSTICS__ === true
const optimisticSendTraceEnabled = () => globalThis.__ZILLION_SEND_TRACE__ === true
const messagingDetailsEnabled = () => globalThis.__ZILLION_MESSAGING_DETAILS__ === true
const messagingDiagnosticsEnabled = () => developmentEnabled() || productionDiagnosticsEnabled()
const messagingConsoleEnabled = () => messagingDetailsEnabled() || productionDiagnosticsEnabled()

function safeRelay (value) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return ['ws:', 'wss:'].includes(url.protocol) ? `${url.protocol}//${url.host}` : undefined
  } catch {
    return undefined
  }
}

function emitOptimisticSendTrace (detail) {
  try {
    if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return
    globalThis.dispatchEvent(new globalThis.CustomEvent(sendTraceEvent, { detail }))
  } catch {}
}

export function recordMessagingPerformance (entry) {
  if (!messagingDiagnosticsEnabled()) return
  const strings = [
    'stage', 'source', 'action', 'eventId', 'publicationId', 'seedRecordId', 'requestId', 'parentId',
    'reason', 'state', 'code', 'errorCode', 'operation', 'phase', 'bufferStage', 'type', 'outcome', 'pauseReason'
  ]
  const numbers = [
    'at', 'elapsedMs', 'expediteRemainingMs', 'timelineWorkMs', 'messageCount', 'rowCount',
    'uniqueCount', 'existingCount', 'insertedCount', 'blockedCount', 'expiredCount', 'storedCount',
    'skippedCount', 'queueBytes', 'payloadBytes', 'queuedAgeMs', 'chunkIndex', 'eventCount',
    'flushEventCount', 'remainingEvents', 'remainingInterruptedRelays', 'pendingRelayCount', 'failureCount',
    'queuedEvents', 'queuedBytes', 'oldestQueuedMs', 'maxBytes', 'rangeStart', 'rangeEnd',
    'recoverySince', 'bytes', 'backoffMs', 'retryAt', 'retryAfterMs', 'suppressedCount'
  ]
  const booleans = ['complete', 'isLast', 'expectedCancellation']
  const isAllowed = key => {
    if (strings.includes(key)) return typeof entry[key] === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(entry[key])
    if (numbers.includes(key)) return Number.isFinite(entry[key])
    return typeof entry[key] === 'boolean'
  }
  const value = Object.fromEntries([...strings, ...numbers, ...booleans].filter(isAllowed).map(key => [key, entry[key]]))
  const relay = safeRelay(entry.relay)
  if (relay) value.relay = relay
  if (value.eventId) {
    traces ??= new Map()
    const trace = traces.get(value.eventId) ?? []
    trace.push(value)
    if (trace.length > 32) trace.shift()
    traces.delete(value.eventId); traces.set(value.eventId, trace)
    if (traces.size > 128) traces.delete(traces.keys().next().value)
  }
  if (!messagingConsoleEnabled()) return
  console.debug(`${prefix} ${JSON.stringify(value)}`)
  if (entry.stage === 'bubble-saved' && value.eventId) {
    const trace = traces?.get(value.eventId) || []
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
