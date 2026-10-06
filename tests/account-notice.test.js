import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccountNotice } from '#services/account-notice.js'
import { createPersistentToasts } from '#helpers/persistent-toasts.js'

const owner = 'a'.repeat(64)
const other = 'b'.repeat(64)
const available = { pubkey: owner, connection: 'connected', access: 'allowed', isLocked: false, isReadOnly: false }
const messages = { locked: () => 'Unlock', readonly: () => 'Enable signing' }
function fixture (t) {
  let entries = []
  let updates = 0
  const toasts = createPersistentToasts({ onChange: next => { entries = next; updates++ } })
  const notice = createAccountNotice({ show: toasts.show, messages })
  t.after(() => notice.close())
  return { notice, toasts, entries: () => entries, updates: () => updates }
}

test('unknown startup, bridge failure and access denial create no account warning', t => {
  const f = fixture(t)
  for (const state of [null, { ...available, connection: 'unknown', isLocked: null, isReadOnly: null }, { ...available, connection: 'disconnected' }, { ...available, access: 'revoked' }, { ...available, isLocked: null }, { ...available, isReadOnly: null }]) f.notice.update(owner, state)
  assert.deepEqual(f.entries(), [])
  f.notice.update(owner, available)
  assert.deepEqual(f.entries(), [], 'a ready account needs no warning, even while offline')
})

test('confirmed lock stays protected through unknown snapshots and closes only on full availability', t => {
  const f = fixture(t)
  const locked = { ...available, isLocked: true }
  f.notice.update(owner, locked)
  const entry = f.entries()[0]
  assert.equal(entry.message, messages.locked)
  assert.equal(entry.dismissible, false)
  f.toasts.dismiss(entry.id)
  const count = f.updates()
  for (const state of [locked, { ...locked }, null, { ...available, connection: 'disconnected', isLocked: null, isReadOnly: null }, { ...available, access: 'revoked' }, { ...available, isLocked: null }, { ...available, isReadOnly: null }]) f.notice.update(owner, state)
  assert.equal(f.updates(), count)
  assert.equal(f.entries()[0].id, entry.id)
  f.notice.update(owner, available)
  assert.deepEqual(f.entries(), [])
})

test('read-only takes priority and updates the same notice when the confirmed reason changes', t => {
  const f = fixture(t)
  f.notice.update(owner, { ...available, isLocked: true })
  const id = f.entries()[0].id
  f.notice.update(owner, { ...available, isReadOnly: true, isLocked: true })
  assert.equal(f.entries()[0].id, id)
  assert.equal(f.entries()[0].message, messages.readonly)
  f.notice.update(owner, { ...available, isReadOnly: true })
  assert.equal(f.entries()[0].message, messages.readonly, 'unlocking cannot resolve read-only access')
  f.notice.update(owner, { ...available, isLocked: true })
  assert.equal(f.entries()[0].message, messages.locked)
})

test('account changes clear the old notice and ignore snapshots belonging to another identity', t => {
  const f = fixture(t)
  f.notice.update(owner, { ...available, isLocked: true })
  f.notice.update(other, { ...available, isLocked: true })
  assert.deepEqual(f.entries(), [])
  f.notice.update(other, { ...available, pubkey: other, isReadOnly: true })
  assert.equal(f.entries()[0].key, `account:${other}`)
  f.notice.update(other, available)
  assert.equal(f.entries().length, 1)
  f.notice.update(null, null)
  assert.deepEqual(f.entries(), [])
})

test('notice removal and root teardown preserve unrelated notices and reject late snapshots', t => {
  const f = fixture(t)
  f.toasts.show({ key: 'unrelated', message: 'Keep me' })
  f.notice.update(owner, { ...available, isLocked: true })
  f.notice.close()
  f.notice.update(owner, { ...available, isReadOnly: true })
  assert.deepEqual(f.entries().map(entry => entry.key), ['unrelated'])
})
