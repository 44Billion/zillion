import { npubEncode } from 'libp2r2p/nip19'

const text = value => typeof value === 'string' ? value.trim() : ''

export function profileDetails (person) {
  const metadata = person.profile ?? person
  const npub = /^[0-9a-f]{64}$/i.test(person.pubkey ?? '') ? npubEncode(person.pubkey) : text(person.npub)
  const nip05 = text(metadata.nip05)
  const identifier = nip05 || npub
  return {
    name: text(metadata.name) || text(metadata.display_name),
    displayName: text(metadata.display_name), username: text(metadata.name),
    nip05, npub, identifier,
    identifierLabel: !nip05 && npub ? `${npub.slice(0, 12)}…${npub.slice(-8)}` : identifier,
    about: text(metadata.about), banner: text(metadata.banner)
  }
}
