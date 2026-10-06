import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAvatarPresentation } from '#services/avatar-presentation.js'
import { isKnownAvatarProfile } from '#helpers/avatar.js'

test('profile placeholders stay pending but supplied metadata and signed empty content are known', () => {
  for (const profile of [null, {}, [], { picture: undefined }, { meta: {} }]) assert.equal(!!isKnownAvatarProfile(profile), false)
  for (const profile of [{ name: 'Known' }, { picture: null }, { picture: 'invalid' }, { meta: { events: [{ kind: 0 }] } }]) assert.equal(!!isKnownAvatarProfile(profile), true)
})

function fixture (t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const history = []
  const presentation = createAvatarPresentation({ onChange: state => history.push(state) })
  t.after(() => presentation.close())
  presentation.start('alice')
  return { presentation, history, state: () => history.at(-1) }
}

test('initial metadata and image preparation share a single ten-second visual budget', t => {
  const { presentation: p, state } = fixture(t)
  p.update({ pk: 'alice', picture: null, pending: true })
  t.mock.timers.tick(6000)
  p.update({ pk: 'alice', picture: 'a', pending: false })
  t.mock.timers.tick(3999)
  assert.equal(state().initial, true)
  p.update({ pk: 'alice', picture: 'newer', pending: false })
  t.mock.timers.tick(1)
  assert.equal(state().initial, false)
  assert.equal(state().displayed, null)
  p.present({ pk: 'alice', url: 'newer', src: 'decoded-a' })
  assert.equal(state().initial, false, 'late success never renews the pulse')
  assert.equal(state().displayed.src, 'decoded-a')
})

test('a ready cached photo has no minimum pulse duration', t => {
  const { presentation: p, state } = fixture(t)
  p.update({ pk: 'alice', picture: 'cached', pending: true })
  p.present({ pk: 'alice', url: 'cached', src: 'bytes' })
  assert.equal(state().initial, false)
  assert.equal(state().displayed.src, 'bytes')
})

test('empty, invalid, failed and offline first resolutions release the fallback', t => {
  const { presentation: p, state } = fixture(t)
  p.update({ pk: 'alice', picture: null, pending: false })
  assert.equal(state().initial, false)
  p.update({ pk: 'alice', picture: 'late', pending: true })
  assert.equal(state().initial, false)
  p.reject({ pk: 'alice', url: 'late' })
  assert.equal(state().displayed, null)
  p.present({ pk: 'alice', url: 'late', src: 'late-bytes' })
  assert.equal(state().displayed.src, 'late-bytes')
})

test('photo replacement is atomic and a failed candidate retains the previous photo', t => {
  const { presentation: p, state, history } = fixture(t)
  p.update({ pk: 'alice', picture: 'a', pending: false })
  p.present({ pk: 'alice', url: 'a', src: 'bytes-a' })
  const settled = history.length
  p.update({ pk: 'alice', picture: 'b', pending: false })
  assert.equal(state().displayed.src, 'bytes-a')
  p.reject({ pk: 'alice', url: 'b' })
  assert.equal(state().displayed.src, 'bytes-a')
  p.present({ pk: 'alice', url: 'b', src: 'bytes-b' })
  assert.equal(state().displayed.src, 'bytes-b')
  p.update({ pk: 'alice', picture: null, pending: false })
  assert.equal(state().displayed, null, 'explicit removal presents DiceBear')
  assert.ok(history.slice(settled).every(state => !state.initial))
})

test('image failure ends the first pulse and pubkey changes reject obsolete completions', t => {
  const { presentation: p, state } = fixture(t)
  p.update({ pk: 'alice', picture: 'broken', pending: false })
  p.reject({ pk: 'alice', url: 'broken' })
  assert.equal(state().initial, false)
  p.start('bob')
  p.update({ pk: 'bob', picture: 'new', pending: true })
  p.present({ pk: 'alice', url: 'broken', src: 'old' })
  p.reject({ pk: 'alice', url: 'broken' })
  p.update({ pk: 'alice', picture: null, pending: false })
  assert.equal(state().initial, true)
  assert.equal(state().displayed, null)
  p.present({ pk: 'bob', url: 'obsolete', src: 'obsolete' })
  assert.equal(state().displayed, null)
  p.present({ pk: 'bob', url: 'new', src: 'new' })
  assert.equal(state().displayed.src, 'new')
})

test('teardown clears the initial timer and ignores late results', t => {
  const { presentation: p, history } = fixture(t)
  p.update({ pk: 'alice', picture: 'a', pending: true })
  const count = history.length
  p.close()
  t.mock.timers.tick(20000)
  p.present({ pk: 'alice', url: 'a', src: 'late' })
  assert.equal(history.length, count)
})
