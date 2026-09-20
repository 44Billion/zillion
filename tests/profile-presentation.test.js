import { test } from 'node:test'
import assert from 'node:assert/strict'
import { npubEncode } from 'libp2r2p/nip19'
import { profileDetails } from '../src/helpers/profile-presentation.js'

test('profile metadata prefers display_name and preserves a full shareable identity', () => {
  const pubkey = 'a'.repeat(64)
  const person = { self: true, pubkey, name: 'Old name', profile: { display_name: '  Display  ', name: 'username', nip05: '  me@example.com ', about: 'A\n\nB', banner: 'https://example.com/banner.jpg' } }
  const data = profileDetails(person)
  assert.equal(data.name, 'Display')
  assert.equal(data.identifier, 'me@example.com')
  assert.equal(data.npub, npubEncode(pubkey))
  assert.equal(data.about, 'A\n\nB')
  assert.equal(person.profile.nip05, '  me@example.com ')
})

test('missing or malformed metadata stays absent and npub is shortened only for display', () => {
  const npub = npubEncode('b'.repeat(64))
  const data = profileDetails({ name: 'Local contact label', npub, profile: { display_name: {}, name: ' ', nip05: [], about: null, banner: false } })
  assert.equal(data.name, '')
  assert.equal(data.identifier, npub)
  assert.ok(data.identifierLabel.includes('…'))
  assert.ok(data.identifierLabel.length < npub.length)
  assert.equal(data.about, '')
  assert.equal(data.banner, '')
  assert.equal(profileDetails({ self: true, profile: {} }).identifier, '')
  assert.equal(profileDetails({ profile: { display_name: ' ', name: 'username' } }).name, 'username')
})
