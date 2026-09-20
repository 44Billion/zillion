import { bech32 } from '@scure/base'
import { p2tr } from '@scure/btc-signer/payment.js'
import { hexToBytes } from 'libp2r2p/base16'
import { npubDecode } from 'libp2r2p/nip19'

const text = value => typeof value === 'string' ? value.trim() : ''
const MAX_LIGHTNING_LENGTH = 4096

function payUrl (value) {
  if (/\s/.test(value)) return null
  try {
    const url = new URL(value)
    if (!url.hostname || url.username || url.password || url.hash) return null
    const result = url.protocol === 'lnurlp:'
      ? new URL(value.replace(/^lnurlp:/i, url.hostname.endsWith('.onion') ? 'http:' : 'https:'))
      : url
    if (result.protocol !== 'https:' && !(result.protocol === 'http:' && result.hostname.endsWith('.onion'))) return null
    if (result.searchParams.has('tag') && result.searchParams.get('tag') !== 'payRequest') return null
    return result.href
  } catch { return null }
}

// Syntax only: confirming payRequest requires an endpoint request, never a profile render.
export function parseProfileLightning (input) {
  const value = text(input)
  if (!value || value.length > MAX_LIGHTNING_LENGTH) return null
  const candidate = value.replace(/^lightning:/i, '')
  const address = /^([a-z0-9_.+-]*)@([^\s/@:#?]+)$/i.exec(candidate)
  if (address && /^[a-z0-9_.+-]*$/.test(address[1])) {
    try {
      const domain = new URL(`https://${address[2]}`)
      if (!domain.hostname.includes('.') || domain.username || domain.password || domain.port || domain.pathname !== '/' || domain.search || domain.hash) return null
      const normalized = `${address[1] || '_'}@${domain.hostname}`
      const protocol = domain.hostname.endsWith('.onion') ? 'http:' : 'https:'
      return { value, field: 'lud16', encoded: normalized, url: `${protocol}//${domain.hostname}/.well-known/lnurlp/${address[1] || '_'}` }
    } catch { return null }
  }
  let url
  if (/^lnurl1/i.test(candidate)) {
    try {
      const decoded = bech32.decode(candidate, MAX_LIGHTNING_LENGTH)
      if (decoded.prefix !== 'lnurl') return null
      url = payUrl(new TextDecoder('utf-8', { fatal: true }).decode(bech32.fromWords(decoded.words)))
    } catch { return null }
  } else {
    url = payUrl(candidate)
  }
  if (!url) return null
  const encoded = bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), false)
  return encoded.length <= MAX_LIGHTNING_LENGTH ? { value, field: 'lud06', encoded, url } : null
}

export function profileLightning (metadata) {
  return parseProfileLightning(metadata.lud16) ?? parseProfileLightning(metadata.lud06)
}

// Mainnet BIP-341 key-path-only output: the Nostr key is the internal key, not the output key.
export function profileBitcoinAddress (person) {
  try {
    const pubkey = person.pubkey || npubDecode(text(person.npub))
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) return ''
    return p2tr(hexToBytes(pubkey.toLowerCase())).address
  } catch { return '' }
}
