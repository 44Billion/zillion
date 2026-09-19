import { npubDecode, npubEncode, nprofileDecode } from 'libp2r2p/nip19'

const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
export const contactIdentifier = person => person.nip05 || person.npub || (person.pubkey ? npubEncode(person.pubkey) : '')

// Decode locally only; relay hints never initiate network requests in this preview.
export function contactQuery (value) {
  const text = value.trim().replace(/^nostr:/i, '')
  try {
    if (/^npub1/i.test(text)) return { text, npub: npubEncode(npubDecode(text.toLowerCase())) }
    if (/^nprofile1/i.test(text)) return { text, npub: npubEncode(nprofileDecode(text.toLowerCase()).pubkey) }
  } catch {}
  return { text }
}

export function matchesContact (person, query) {
  if (query.npub && (person.npub === query.npub || (person.pubkey && npubEncode(person.pubkey) === query.npub))) return true
  return [person.name, person.nip05, person.npub, person.nprofile, contactIdentifier(person)]
    .some(value => normalize(value).includes(normalize(query.text)))
}

export function matchesProfile (person, query) {
  return (query.npub && query.npub === person.npub) ||
    (!!person.nip05 && person.nip05.toLowerCase() === query.text.toLowerCase())
}
