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
