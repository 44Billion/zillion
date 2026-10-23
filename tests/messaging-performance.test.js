import assert from 'node:assert/strict'
import { test } from 'node:test'

test('development messaging performance retains sanitized recovery archive counts', async () => {
  const previousDevelopment = globalThis.IS_DEVELOPMENT
  const previousDetails = globalThis.__ZILLION_MESSAGING_DETAILS__
  const previousDebug = console.debug
  const records = []
  globalThis.IS_DEVELOPMENT = true
  globalThis.__ZILLION_MESSAGING_DETAILS__ = true
  console.debug = value => records.push(JSON.parse(value.slice('[messaging-performance] '.length)))
  try {
    const { recordMessagingPerformance } = await import('../src/services/messaging-performance.js?recovery-diagnostics')
    recordMessagingPerformance({
      stage: 'recovery-archive-result',
      eventId: 'event',
      publicationId: 'publication',
      seedRecordId: `libp2r2p:recovery:seed:${'a'.repeat(64)}`,
      rowCount: 3,
      uniqueCount: 2,
      existingCount: 1,
      insertedCount: 1,
      blockedCount: 0,
      expiredCount: 1,
      storedCount: 2,
      skippedCount: 2,
      content: 'private',
      ciphertext: 'private'
    })
    assert.deepEqual(records, [{
      stage: 'recovery-archive-result',
      eventId: 'event',
      publicationId: 'publication',
      seedRecordId: `libp2r2p:recovery:seed:${'a'.repeat(64)}`,
      rowCount: 3,
      uniqueCount: 2,
      existingCount: 1,
      insertedCount: 1,
      blockedCount: 0,
      expiredCount: 1,
      storedCount: 2,
      skippedCount: 2
    }])
    recordMessagingPerformance({ stage: 'timeline-projected', eventId: 'event', elapsedMs: 75, timelineWorkMs: 4, messageCount: 51, messages: ['private'] })
    assert.deepEqual(records.at(-1), {
      stage: 'timeline-projected',
      eventId: 'event',
      elapsedMs: 75,
      timelineWorkMs: 4,
      messageCount: 51
    })
  } finally {
    console.debug = previousDebug
    if (previousDevelopment === undefined) delete globalThis.IS_DEVELOPMENT
    else globalThis.IS_DEVELOPMENT = previousDevelopment
    if (previousDetails === undefined) delete globalThis.__ZILLION_MESSAGING_DETAILS__
    else globalThis.__ZILLION_MESSAGING_DETAILS__ = previousDetails
  }
})

test('optimistic send trace separates synchronous return from timeline projection', async () => {
  const records = []
  const events = []
  let now = 100
  let wall = 1000
  const { createOptimisticSendTrace } = await import('../src/services/messaging-performance.js?optimistic-send-trace')
  const tracer = createOptimisticSendTrace({
    now: () => now,
    wallNow: () => wall,
    record: entry => records.push(entry),
    emit: entry => events.push(entry)
  })

  const trace = tracer.begin()
  now = 106
  wall = 1006
  tracer.pendingQueued('event', 990)
  tracer.returned(trace, 'event')
  now = 128
  wall = 1028
  tracer.projected([{ id: 'older' }, { id: 'event' }], { workMs: 4, messageCount: 2 })
  now = 150
  tracer.projected([{ id: 'event' }], { workMs: 3, messageCount: 1 })

  assert.deepEqual(records, [
    { stage: 'optimistic-pending-queued', eventId: 'event', elapsedMs: 16 },
    { stage: 'send-returned', eventId: 'event', elapsedMs: 6 },
    {
      stage: 'timeline-projected',
      eventId: 'event',
      elapsedMs: 28,
      timelineWorkMs: 4,
      messageCount: 2
    }
  ])
  assert.deepEqual(events, [
    { stage: 'send-started', at: 1000, token: 'trace-1' },
    { stage: 'optimistic-pending-queued', at: 1006, eventId: 'event', elapsedMs: 16 },
    { stage: 'send-returned', at: 1006, token: 'trace-1', eventId: 'event', elapsedMs: 6 },
    {
      stage: 'timeline-projected',
      at: 1028,
      token: 'trace-1',
      eventId: 'event',
      elapsedMs: 28,
      timelineWorkMs: 4,
      messageCount: 2
    }
  ])
})

test('send trace events remain available without enabling messaging console output', async () => {
  const previousDevelopment = globalThis.IS_DEVELOPMENT
  const previousDetails = globalThis.__ZILLION_MESSAGING_DETAILS__
  const previousSendTrace = globalThis.__ZILLION_SEND_TRACE__
  const previousDebug = console.debug
  const previousDispatch = globalThis.dispatchEvent
  const records = []
  const events = []
  globalThis.IS_DEVELOPMENT = true
  delete globalThis.__ZILLION_MESSAGING_DETAILS__
  globalThis.__ZILLION_SEND_TRACE__ = true
  console.debug = value => records.push(value)
  globalThis.dispatchEvent = event => {
    events.push(event.detail)
    return true
  }
  try {
    const {
      beginOptimisticSendTrace,
      recordOptimisticPendingQueued,
      recordOptimisticSendReturned,
      recordOptimisticTimelineProjected
    } = await import('../src/services/messaging-performance.js?send-trace-without-console')
    const trace = beginOptimisticSendTrace()
    recordOptimisticPendingQueued('event', Date.now() - 5)
    recordOptimisticSendReturned(trace, 'event')
    recordOptimisticTimelineProjected([{ id: 'event' }], { workMs: 2, messageCount: 1 })

    assert.deepEqual(records, [])
    assert.deepEqual(events.map(event => event.stage), [
      'send-started',
      'optimistic-pending-queued',
      'send-returned',
      'timeline-projected'
    ])
  } finally {
    console.debug = previousDebug
    if (previousDispatch === undefined) delete globalThis.dispatchEvent
    else globalThis.dispatchEvent = previousDispatch
    if (previousDevelopment === undefined) delete globalThis.IS_DEVELOPMENT
    else globalThis.IS_DEVELOPMENT = previousDevelopment
    if (previousDetails === undefined) delete globalThis.__ZILLION_MESSAGING_DETAILS__
    else globalThis.__ZILLION_MESSAGING_DETAILS__ = previousDetails
    if (previousSendTrace === undefined) delete globalThis.__ZILLION_SEND_TRACE__
    else globalThis.__ZILLION_SEND_TRACE__ = previousSendTrace
  }
})

test('messaging console traces are opt-in while the bounded buffer remains available', async () => {
  const previousDevelopment = globalThis.IS_DEVELOPMENT
  const previousDetails = globalThis.__ZILLION_MESSAGING_DETAILS__
  const previousDebug = console.debug
  const previousGroupCollapsed = console.groupCollapsed
  const previousTable = console.table
  const previousGroupEnd = console.groupEnd
  const records = []
  const groups = []
  globalThis.IS_DEVELOPMENT = true
  delete globalThis.__ZILLION_MESSAGING_DETAILS__
  console.debug = value => records.push(JSON.parse(value.slice('[messaging-performance] '.length)))
  console.groupCollapsed = value => groups.push(['groupCollapsed', value])
  console.table = value => groups.push(['table', value])
  console.groupEnd = () => groups.push(['groupEnd'])
  try {
    const { recordMessagingPerformance } = await import('../src/services/messaging-performance.js?bubble-diagnostics')
    recordMessagingPerformance({ stage: 'send-start', eventId: 'bubble', content: 'private' })
    recordMessagingPerformance({ stage: 'bubble-saved', eventId: 'bubble', elapsedMs: 42 })

    assert.deepEqual(records, [])
    assert.deepEqual(groups, [])

    globalThis.__ZILLION_MESSAGING_DETAILS__ = true
    recordMessagingPerformance({ stage: 'bubble-saved', eventId: 'bubble', elapsedMs: 43 })
    assert.deepEqual(records, [{ stage: 'bubble-saved', eventId: 'bubble', elapsedMs: 43 }])
    assert.deepEqual(groups.map(([kind]) => kind), ['groupCollapsed', 'table', 'groupEnd'])
    assert.equal(groups[0][1], '[messaging-performance] bubble')
    assert.deepEqual(groups[1][1], [
      { stage: 'send-start', eventId: 'bubble' },
      { stage: 'bubble-saved', eventId: 'bubble', elapsedMs: 42 },
      { stage: 'bubble-saved', eventId: 'bubble', elapsedMs: 43 }
    ])
  } finally {
    console.debug = previousDebug
    console.groupCollapsed = previousGroupCollapsed
    console.table = previousTable
    console.groupEnd = previousGroupEnd
    if (previousDevelopment === undefined) delete globalThis.IS_DEVELOPMENT
    else globalThis.IS_DEVELOPMENT = previousDevelopment
    if (previousDetails === undefined) delete globalThis.__ZILLION_MESSAGING_DETAILS__
    else globalThis.__ZILLION_MESSAGING_DETAILS__ = previousDetails
  }
})
