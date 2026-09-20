import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bech32 } from '@scure/base'
import { npubEncode } from 'libp2r2p/nip19'
import { parseProfileLightning, profileLightning, profileBitcoinAddress } from '../src/helpers/profile-payments.js'

const encode = url => bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), false)

test('profile Lightning maps addresses to lud16 and preserves the full displayed value', () => {
  const parsed = parseProfileLightning('  alice+tips@example.com  ')
  assert.deepEqual(parsed, { value: 'alice+tips@example.com', field: 'lud16', encoded: 'alice+tips@example.com', url: 'https://example.com/.well-known/lnurlp/alice+tips' })
  assert.equal(parseProfileLightning('lightning:alice@example.com').encoded, 'alice@example.com')
  assert.equal(parseProfileLightning('@example.com').encoded, '_@example.com')
  assert.equal(parseProfileLightning('alice@abcdef.onion').url, 'http://abcdef.onion/.well-known/lnurlp/alice')
  assert.equal(parseProfileLightning('Alice@example.com'), null)
  assert.equal(parseProfileLightning('alice@example.com\\other'), null)
})

test('profile LNURL accepts bech32, lightning-prefixed, raw and LUD-17 pay forms', () => {
  const url = 'https://example.com/lnurlp/alice?token=CaseSensitive'
  const lnurl = encode(url)
  for (const input of [lnurl, lnurl.toUpperCase(), `lightning:${lnurl}`, `LIGHTNING:${lnurl.toUpperCase()}`, url, url.replace('https:', 'lnurlp:')]) {
    const parsed = parseProfileLightning(input)
    assert.equal(parsed.value, input)
    assert.equal(parsed.field, 'lud06')
    assert.equal(parsed.encoded, lnurl)
    assert.equal(parsed.url, url)
  }
  assert.equal(parseProfileLightning('lnurlp://abcdef.onion/pay').url, 'http://abcdef.onion/pay')
  assert.equal(parseProfileLightning(encode('https://example.com/pay?tag=payRequest')).url, 'https://example.com/pay?tag=payRequest')
})

test('Lightning syntax rejects invalid checksums, non-pay schemes and unsafe endpoints without fetching', () => {
  const lnurl = encode('https://example.com/pay')
  for (const input of [null, {}, '', 'alice', 'https://', 'lightning:lnbc123', 'lnurlw://example.com/pay', 'keyauth://example.com/pay', 'javascript:alert(1)', 'http://example.com/pay', 'https://user:password@example.com/pay', 'https://example.com/pay#fragment', 'https://example.com/pay?tag=withdrawRequest', encode('https://example.com/pay?tag=login'), lnurl.slice(0, -1) + (lnurl.endsWith('q') ? 'p' : 'q'), 'LNURL' + lnurl.slice(5), 'x'.repeat(4097)]) {
    assert.equal(parseProfileLightning(input), null, String(input).slice(0, 80))
  }
})

test('profile metadata prefers usable lud16 and tolerates formats stored in either field', () => {
  const lnurl = encode('https://example.com/pay')
  assert.equal(profileLightning({ lud16: 'alice@example.com', lud06: lnurl }).field, 'lud16')
  assert.equal(profileLightning({ lud16: 'invalid', lud06: lnurl }).value, lnurl)
  assert.equal(profileLightning({ lud06: 'alice@example.com' }).field, 'lud16')
  assert.equal(profileLightning({ lud16: 'lnurlp://example.com/pay' }).field, 'lud06')
  assert.equal(profileLightning({ lud16: [], lud06: 'broken' }), null)
})

test('Bitcoin profile address matches the official BIP-341 key-only wallet vector', () => {
  // https://github.com/bitcoin/bips/blob/master/bip-0341/wallet-test-vectors.json
  const pubkey = 'd6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d'
  const address = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5'
  assert.equal(profileBitcoinAddress({ pubkey }), address)
  assert.equal(profileBitcoinAddress({ pubkey: pubkey.toUpperCase() }), address)
  assert.equal(profileBitcoinAddress({ npub: npubEncode(pubkey) }), address)
  assert.equal(profileBitcoinAddress({ pubkey, profile: { bitcoin: 'untrusted replacement' } }), address)
  for (const person of [{}, { pubkey: '0'.repeat(64) }, { pubkey: 'f'.repeat(64) }, { pubkey: 'invalid' }, { npub: 'npub1invalid' }]) assert.equal(profileBitcoinAddress(person), '')
})
