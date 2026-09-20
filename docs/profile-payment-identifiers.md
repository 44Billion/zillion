# Profile payment identifiers

This is profile presentation and a local editor draft, not a wallet. No invoice,
LNURL endpoint, blockchain lookup, signing, transfer or kind-0 publication is
introduced. Native Share/Copy receives the complete displayed value, including
its original `lightning:` prefix when present.

## Lightning metadata

[NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) refers to
`lud16` on a kind-0 profile. The
[nostr-tools implementation](https://github.com/nbd-wtf/nostr-tools/blob/master/nip57.ts)
uses `lud16` for a Lightning address and `lud06` for a bech32-encoded LNURL.
[NIP-24](https://github.com/nostr-protocol/nips/blob/master/24.md) does not enumerate
these fields. They are not interchangeable encodings of a Bitcoin address.

- [LUD-16](https://github.com/lnurl/luds/blob/luds/16.md): `name@domain`, resolving
  to the service's `/.well-known/lnurlp/name` endpoint.
- [LUD-01](https://github.com/lnurl/luds/blob/luds/01.md) and
  [LUD-06](https://github.com/lnurl/luds/blob/luds/06.md): bech32 `lnurl1…`,
  optionally prefixed with `lightning:`; the underlying endpoint must offer payRequest.
- [LUD-17](https://github.com/lnurl/luds/blob/luds/17.md), a draft: `lnurlp://…`
  identifies a raw pay URL. Raw HTTPS URLs and HTTP onion URLs are also accepted.

Read the first syntactically valid value from `lud16`, then `lud06`, tolerating a
supported format stored in either field. A bounded read-only sample on 2026-09-20
from relay.44billion.net, nos.lol, relay.dreamith.to and relay.primal.net observed
both fields, including address strings in `lud06`. This is interoperability
evidence, not a substitute for the specifications or verification of endpoints.

The one Lightning input preserves its raw local draft. Address drafts map to
`lud16`; LNURL drafts map to canonical bech32 `lud06`, clearing the other field in
the draft. Clearing the input clears both. Invalid input is marked locally and
never becomes an actionable profile row. Save remains disabled. No endpoint is
fetched to confirm `tag: payRequest`; format acceptance does not verify a wallet.
Known non-pay schemes/tags, invalid bech32 checksums, mixed-case bech32, cleartext
non-onion URLs and credential-bearing URLs are rejected.

## Bitcoin derivation

The user-selected
[NIP-BC draft revision](https://github.com/alexgleason/nips/blob/2eee3ef5ded99f1a9eeefd49a6fb5592f8964fe3/BC.md#deriving-the-recipients-bitcoin-address)
is the reference for this feature; it is not treated as an adopted numbered NIP.
Use the Nostr x-only public key as the internal key of a mainnet BIP-341 P2TR
output, with the standard key-path-only TapTweak and no script tree. Encode the
output as bech32m with prefix `bc`. Do not directly encode the untweaked Nostr key.
The address is derived from the identity, never from arbitrary kind-0 content.
Invalid/missing curve points produce no address. The editor is read-only.

The installed libp2r2p exports were reviewed; they provide npub and hex codecs,
but no LNURL or Taproot address API. Use its public codecs, `@scure/base` for
LNURL bech32, and the public `@scure/btc-signer/payment.js` `p2tr` API for Bitcoin.
Zillion only owns the profile-field mapping and presentation; it does not
implement elliptic-curve arithmetic, tweak hashing or Bitcoin checksums.
Tests include the official BIP-341 no-script-tree wallet vector.

## Presentation

NIP-05 remains available when present; npub has its own copy/share row in that
case. NIP-05 and npub share the user icon, green for NIP-05 and purple for npub.
These icons, yellow Lightning and orange Bitcoin share a fixed column, as do the
copy/share controls. Missing Lightning/Bitcoin values omit
the corresponding rows; an unavailable Nostr identity keeps its disabled state.
Long values shorten only visually. Fixtures are previews, not payment destinations.
