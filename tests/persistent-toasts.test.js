import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPersistentToasts, normalizeToast } from '#helpers/persistent-toasts.js'

function fixture () {
  let entries = []
  let updates = 0
  const notices = createPersistentToasts({ onChange: next => { entries = next; updates++ } })
  return { notices, entries: () => entries, updates: () => updates }
}

test('keyed updates keep one notice and DOM identity without reannouncing unchanged content', () => {
  const f = fixture()
  const handle = f.notices.show({ key: 'account', type: 'warning', message: 'Unlock', dismissible: false })
  const id = f.entries()[0].id
  handle.update({ message: 'Enable signing' })
  assert.equal(f.entries().length, 1)
  assert.equal(f.entries()[0].id, id)
  assert.equal(f.entries()[0].type, 'warning')
  assert.equal(f.entries()[0].dismissible, false)
  assert.equal(f.entries()[0].revision, 2)
  const count = f.updates()
  handle.update({ message: 'Enable signing' })
  assert.equal(f.updates(), count)
})

test('manual dismissal respects protection while owner close removes only its notice', () => {
  const f = fixture()
  const account = f.notices.show({ key: 'account', message: 'Unlock', dismissible: false })
  f.notices.show({ key: 'other', message: 'Another notice' })
  f.notices.dismiss(f.entries()[0].id)
  assert.equal(f.entries().length, 2)
  account.close()
  assert.deepEqual(f.entries().map(entry => entry.key), ['other'])
  f.notices.dismiss(f.entries()[0].id)
  assert.deepEqual(f.entries(), [])
})

test('a replacement publisher keeps the key identity but obsolete handles cannot affect it', () => {
  const f = fixture()
  const old = f.notices.show({ key: 'same', message: 'Old' })
  const id = f.entries()[0].id
  const current = f.notices.show({ key: 'same', message: 'Current' })
  assert.equal(f.entries()[0].id, id)
  old.update({ message: 'Obsolete' }); old.close()
  assert.equal(f.entries()[0].message, 'Current')
  current.close()
  old.update({ message: 'Resurrected' })
  assert.deepEqual(f.entries(), [])
})

test('host cleanup invalidates all handles without affecting a later host generation', () => {
  const f = fixture()
  const old = f.notices.show({ key: 'same', message: 'Old' })
  f.notices.clear()
  f.notices.show({ key: 'same', message: 'Fresh' })
  old.close(); old.update({ message: 'Stale' })
  assert.equal(f.entries()[0].message, 'Fresh')
})

test('unkeyed notices remain independent and text callbacks keep their identity', () => {
  const f = fixture()
  const message = () => 'Live text'
  f.notices.show({ message }); f.notices.show({ message })
  assert.equal(f.entries().length, 2)
  assert.notEqual(f.entries()[0].id, f.entries()[1].id)
  assert.equal(f.entries()[0].message, message)
  assert.deepEqual(normalizeToast({ type: 'invalid' }), { type: 'info', message: '', longMessage: '', dismissible: true })
})
