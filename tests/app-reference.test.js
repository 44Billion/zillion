import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appEncode, naddrEncode, npubEncode, nprofileEncode } from 'libp2r2p/nip19'
import { decodeAppUrl } from 'libp2r2p/url'
import { appReferenceUrl } from '#helpers/app-reference.js'
import { parseChatContent } from '#helpers/chat-content.js'

const pubkey = 'ab'.repeat(32)
const app = value => {
  const [item] = parseChatContent(value)
  assert.equal(item.key, 'app', value)
  return item.app
}

test('app links omit only the root 44billion author, with all channels and optional nostr prefix', () => {
  for (const prefix of ['+', '++', '+++']) {
    for (const suffix of ['', '@44billion.net', '@_@44billion.net']) {
      for (const scheme of ['', 'nostr:']) {
        assert.equal(appReferenceUrl(app(`${scheme}${prefix}example${suffix}`)), `https://44billion.net/${prefix}example`)
      }
    }
  }
  assert.equal(appReferenceUrl(app('+example@alice@44billion.net')), 'https://44billion.net/+example@alice.44billion.net')
  assert.equal(appReferenceUrl(app('+example@_@example.com')), 'https://44billion.net/+example@example.com')
  const longName = 'x'.repeat(60)
  assert.equal(appReferenceUrl(app(`+${longName}@44billion.net`)), `https://44billion.net/+${longName}@44billion.net`)
})

test('app links retain decoded author identity, relay hints and channel', () => {
  for (const author of ['bob@example.com', 'bob.example.com', npubEncode(pubkey), nprofileEncode({ pubkey, relays: ['wss://relay.example.com'] }), pubkey]) {
    const original = app(`nostr:+++testing@${author}`)
    const decoded = decodeAppUrl(new URL(appReferenceUrl(original)).pathname.slice(1))
    assert.equal(decoded.appName, original.appName)
    assert.equal(decoded.channel, original.channel)
    assert.deepEqual(decoded.user, original.user)
  }
})

test('app links retain encoded entities and canonicalize site naddr using the library', () => {
  for (const channel of ['main', 'next', 'draft']) {
    const entity = appEncode({ pubkey, dTag: 'testing', channel })
    assert.equal(appReferenceUrl(app(`nostr:${entity}`)), `https://44billion.net/${entity}`)
  }
  const reference = naddrEncode({ pubkey, identifier: 'testing', kind: 35130, relays: ['wss://relay.example.com'] })
  const parsed = app(`+${reference}`)
  assert.equal(decodeAppUrl(new URL(appReferenceUrl(parsed)).pathname.slice(1)).entity, parsed.entity)
})

test('app names remain a single path segment without introducing query or fragment syntax', () => {
  for (const author of ['_@44billion.net', 'bob@example.com']) {
    const original = app(`+my%40app%3Fq%3D1%23part@${author}`)
    const url = new URL(appReferenceUrl(original))
    assert.equal(url.origin, 'https://44billion.net')
    assert.equal(url.search, '')
    assert.equal(url.hash, '')
    assert.equal(decodeAppUrl(url.pathname.slice(1)).appName, original.appName)
  }
})

test('installed extraction recognizes launcher HTTPS links without converting them into app items', () => {
  for (const value of [
    'https://44billion.net/+3swFhu23QNl8er5yOtc8bf9ueHCdwF8CzoDUiSSwwKIWoS8Ki5TwMyeA3Js1',
    'https://44billion.net/+apps?by=fiatjaf.com',
    `https://44billion.net/+++testing@${npubEncode(pubkey)}?by=fiatjaf.com`
  ]) {
    assert.deepEqual(parseChatContent(value), [{ key: 'url', url: { value } }])
  }
})
