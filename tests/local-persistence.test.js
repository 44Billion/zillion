import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localPersistenceFailures } from '../src/services/local-persistence.js'

test('local notice includes only confirmed remote messages with actual local failures', () => {
  const base = { id: 'message', peer: 'peer', status: 'saved', localPersistence: { state: 'failed', retryable: true } }
  const rows = [base, { ...base, peer: 'other' }, { ...base, status: 'pending' }, { ...base, localPersistence: { state: 'pending' } }, { ...base, localPersistence: { state: 'saved' } }]
  assert.deepEqual(localPersistenceFailures(rows, 'owner', 'peer'), [base])
  assert.deepEqual(localPersistenceFailures(rows, '', 'peer'), [])
  assert.deepEqual(localPersistenceFailures(rows, 'peer', 'peer'), [])
})
