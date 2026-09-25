# Private chats

The account-root coordinator owns one libp2r2p 0.10.20 PrivateMessenger for the
instance's primary account. It survives route changes. `createChat` provides the
same pages of 50, four-worker decryption, viewport, references, attachments and
viewer for self and peer chats. Self-chat never publishes remotely. Additional
persona inboxes are not opened; scoped signer/state/store APIs prepare that use.

## Contacts and routes

The directory combines owner kind 3 public and personal lists with the owner's
personal kind 30000 (`d=+zillion:contacts`), in context `''`. Only the override
list is written. `p` fields are pubkey, relay hint, petname, membership: `0`
excludes, `1`/absent includes; CRDT suffixes are not membership values. Other
entries and their metadata survive edits. Removing a contact keeps history and
suspends sending/listening; re-adding resumes the available recovery interval.

`/chat/user` is self-chat; `/chat/<64-character peer key>` uses the real shared
chat service. `/contacts/add` searches current contacts and resolves complete
NIP-19/NIP-05 identifiers through point profile lookups; profile cache is shared
with home and chat. `/profile/:contactId` persists contact changes. Pinning and
profile editing remain local previews; removing a contact clears the local pin.
No bottom navigation is added.

## Delivery and storage

`withSharedKey(peer, 'dm')` derives each stable symmetric channel. The peer is
the only remote recipient. Incoming delivery validates channel, transport sender,
inner identity/signature and provenance, saves a personal copy in `dm:<peer>`,
then acknowledges the persistent reservation. Interrupted saves are redelivered.
Hearsay supplies reference context only, never a new main timeline message or an
authoritative deletion. Matching direct/signed copies take precedence.

The outbox is IndexedDB `zillion:outbox:<owner>`, version 1, store `entries` with
keyPath `id`. Rows contain only an opaque event ID and ciphertext. The plaintext
entry is encrypted via the owner's NIP-44v3 signer using kind 9 and scope
`zillion:outbox`. It records peer, stable inner events, local-save flags, publication
cursor and IRFS chunk progress. No plaintext message or attachment bytes are
stored in this app database. It is durable user data, not an evictable cache.
No data migration or compatibility aliases are introduced.

Attachment preparation persists and verifies chunks and metadata in launcher
storage before outbox acceptance. The outgoing personal message commits before
remote attachment publication, so an offline failure cannot defer that local copy. Composer content clears only after the encrypted
record commits; preparation failure preserves it. After reload the same event
IDs/timestamps/salts resume only unfinished stages. A crash between a relay's
acceptance and a progress checkpoint can republish the same ID. Acceptance means
relay publication, never delivery/read confirmation. Pending and failed entries
remain visible. A reply includes one quoted level and its file metadata; missing
optional quoted file bytes do not block the new message.

Only the current attachment must have all bytes locally available before queueing.
IRFS chunks are read/published individually; a large attachment does not create an
unbounded decoded transport queue. Independent personal catalog copies stay in
context `''`. The media viewer counts 1063 in the conversation independently of
chat pages and snapshots URL extras only from loaded messages.

“Delete for me” stores a local private kind 5. “Delete for everyone” additionally
queues that request remotely and is restricted to own messages. Both cancel
pending publication of the selected message first. Already accepted in-flight
remote copies cannot be revoked locally; remote deletions do not guarantee that
all copies everywhere disappear. Removing a contact does not delete history.

## Availability and presentation

Signer-state notifications pause/resume inbox network work and outbox sending.
Account lock, read-only, connection and persona access are distinct. Each write
still handles races after notification. Unlock/reconnection recovers history and
retryable outbox work; visible failed preparations retry without repeating known
permission denials. Hearsay quotes show “Unverified” and a native, focus-contained
dialog, bottom-aligned on mobile and centered on desktop, with Escape and focus
restoration. All new labels have eleven translations.

Messenger recovery defaults to seven days and depends on retained relay/seeder
data. Visited chat pages remain in memory for this session; history is paginated,
not virtualized. Local outbox records survive app closure under the same app/user
origin. Clearing site storage removes that outbox; it is not cross-device sync.

## Demonstrations and validation

`ZILLION_DEMO=1 npm run build` enables bundled fictional contacts/messages with no
real channels or contact writes. The default build has no sample contacts. The
photo promised by the sample conversation is included. Browser fixtures are
separate entry points and never included in published builds.

Node tests cover membership/CRDT selection, ack-after-save, removed-contact
queues, durable retries and encrypted records. Chrome integration uses the real
launcher/vault and two accounts with only the relay boundary controlled:
`node ../../44billion/bin/run-browser-tests.js -- env ZILLION_PRIVATE_ONLY=1 node --test tests/browser/self-chat.browser.js`.
Run browser units sequentially within the guarded 3 GiB budget, alongside the
existing self-chat, attachment, history, profile and viewer regressions.


Validation on 2026-09-23 used the published npm package (no checkout imports):
launcher 923 Node tests, vault 306, and Zillion 136 passed, together with changed
source lint and production builds. Guarded Chrome units covered contacts/profile,
route retention, demonstration photo, message status, self-chat text/replies and
offline ordering, attachments/catalog recovery, and the media viewer. The largest
observed unit peak was 2728 MiB, below the 3072 MiB limit with swap disabled.

The history regression loaded all 235 same-second events without loss, preserving
reading position and draft across retained routes and deletion recovery. With the
real vault, the measured 50-event opening used zero extra queries, four concurrent
decryptions and one grouped update (14.21 s); the comparison path queried and
decrypted 200 events serially (58.73 s). These are controlled-environment timings,
not an end-user latency guarantee. The viewer retained 28 image sources before
and after traversing its long sequence. Remote transport tests use a controlled
relay boundary; availability/retention on public relays is not guaranteed by them.

The final two-account Chrome run additionally passed encrypted peer text/replies
and file delivery, owner-attributed hearsay with its explanation dialog, vault
lock/unlock, contact removal/re-addition, local/remote deletion, an interrupted
outbox resumed after reload under the same event ID, and terminal persona
revocation with account details hidden. Its guarded peak was 2329 MiB.
