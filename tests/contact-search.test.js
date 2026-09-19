import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nprofileEncode } from 'libp2r2p/nip19'
import { contactQuery, matchesContact, matchesProfile } from '../src/helpers/contact-search.js'

const people = JSON.parse(readFileSync(new URL('../src/components/views/contacts/fixtures/people.json', import.meta.url)))
const luna = people.find(person => !person.saved)

test('contact search matches names without accents, partial identifiers and equivalent profile pointers', () => {
  assert.ok(matchesContact({ name: 'João Silva' }, contactQuery('joao')))
  assert.ok(matchesContact(luna, contactQuery('LUNA@EXAMPLE')))
  assert.ok(matchesContact(luna, contactQuery(`nostr:${luna.npub}`)))
  const pointer = nprofileEncode({ pubkey: 'b'.padStart(64, '0'), relays: ['wss://example.com'] })
  assert.ok(matchesContact(luna, contactQuery(pointer)))
  assert.ok(matchesProfile(luna, contactQuery(pointer)))
})

test('unsaved profiles require an exact identifier; partial or invalid pointers never fabricate a result', () => {
  for (const value of ['Luna', 'luna@', luna.npub.slice(0, -1), 'npub1invalid', 'nprofile1invalid', '']) {
    assert.equal(!!matchesProfile(luna, contactQuery(value)), false)
  }
  assert.ok(matchesProfile(luna, contactQuery(' LUNA@EXAMPLE.COM ')))
  assert.ok(matchesProfile(luna, contactQuery(luna.nprofile)))
  assert.equal(!!matchesProfile(luna, contactQuery(people[0].npub)), false)
})
