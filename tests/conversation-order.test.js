import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConversationOrder, orderHomeConversations } from '#services/conversation-order.js'

const row = (peer, time) => ({ contact: { pubkey: peer }, lastMessageAt: time })
test('cached positions stay stable independently of one unavailable startup summary', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let state
  const order = createConversationOrder({ onChange: value => { state = value } })
  t.after(() => order.close())
  let rows = [row('a', '200'), row('b', '100'), row('self', '')]
  order.reconcile(rows, {})
  rows = [row('b', '300'), row('a', '200'), row('c', '400'), row('self', '')]
  order.reconcile(rows, { a: { messageReady: true }, b: { messageReady: true } })
  assert.equal(state.live, true, 'the new row and empty peer cannot extend the initial cohort')
  assert.deepEqual(orderHomeConversations(rows, state).map(value => value.contact.pubkey), ['c', 'b', 'a', 'self'])
})

test('message readiness releases order without waiting for file metadata; errors and removals cannot block', t => {
  let state
  const order = createConversationOrder({ onChange: value => { state = value } })
  t.after(() => order.close())
  const rows = [row('a', '100'), row('self', '')]
  order.reconcile(rows, {})
  order.reconcile(rows, { a: { messageReady: true, state: 'loading' }, self: { state: 'unavailable' } })
  assert.equal(state.live, true)
  order.reconcile(rows, {})
  assert.equal(state.live, true, 'new contacts do not restart the startup freeze')
  order.close()
  const previous = state
  order.reconcile([], {})
  assert.equal(state, previous)
})

test('contacts without an initial conversation row cannot hold the startup cohort', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let state
  const order = createConversationOrder({ onChange: value => { state = value } })
  t.after(() => order.close())
  const rows = [row('visible', '100'), row('self', '')]
  order.reconcile(rows, {
    visible: { messageReady: true },
    self: { state: 'loading' },
    empty: { state: 'loading' }
  })
  assert.equal(state.live, true)
})
