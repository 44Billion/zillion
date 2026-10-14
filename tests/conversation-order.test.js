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
  order.reconcile(rows, ['a', 'b', 'self', 'empty'], {})
  rows = [row('b', '300'), row('a', '200'), row('c', '400'), row('self', '')]
  order.reconcile(rows, ['a', 'b', 'c', 'self', 'empty'], { a: { messageReady: true }, b: { messageReady: true } })
  assert.deepEqual(orderHomeConversations(rows, state).map(value => value.contact.pubkey), ['a', 'b', 'c', 'self'])
  t.mock.timers.tick(2999)
  assert.equal(state.live, false)
  t.mock.timers.tick(1)
  assert.deepEqual(orderHomeConversations(rows, state).map(value => value.contact.pubkey), ['c', 'b', 'a', 'self'])
})

test('message readiness releases order without waiting for file metadata; errors and removals cannot block', t => {
  let state
  const order = createConversationOrder({ onChange: value => { state = value } })
  t.after(() => order.close())
  const rows = [row('a', '100'), row('self', '')]
  order.reconcile(rows, ['a', 'self', 'removed'], {})
  order.reconcile(rows, ['a', 'self'], { a: { messageReady: true, state: 'loading' }, self: { state: 'unavailable' } })
  assert.equal(state.live, true)
  order.reconcile(rows, ['a', 'self', 'new'], {})
  assert.equal(state.live, true, 'new contacts do not restart the startup freeze')
  order.close()
  const previous = state
  order.reconcile([], [], {})
  assert.equal(state, previous)
})
