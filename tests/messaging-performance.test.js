import assert from 'node:assert/strict'
import { test } from 'node:test'

test('development messaging performance retains sanitized recovery archive counts', async () => {
  const previousDevelopment = globalThis.IS_DEVELOPMENT
  const previousDebug = console.debug
  const records = []
  globalThis.IS_DEVELOPMENT = true
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
  } finally {
    console.debug = previousDebug
    if (previousDevelopment === undefined) delete globalThis.IS_DEVELOPMENT
    else globalThis.IS_DEVELOPMENT = previousDevelopment
  }
})

test('bubble completion has a single-line summary and detailed tables are opt-in', async () => {
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

    assert.deepEqual(records, [
      { stage: 'send-start', eventId: 'bubble' },
      { stage: 'bubble-saved', eventId: 'bubble', elapsedMs: 42 }
    ])
    assert.deepEqual(groups, [])

    globalThis.__ZILLION_MESSAGING_DETAILS__ = true
    recordMessagingPerformance({ stage: 'bubble-saved', eventId: 'bubble', elapsedMs: 43 })
    assert.equal(records.length, 3)
    assert.deepEqual(groups.map(([kind]) => kind), ['groupCollapsed', 'table', 'groupEnd'])
    assert.equal(groups[0][1], '[messaging-performance] bubble')
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
