# Private chats

The account-root coordinator owns one libp2r2p 0.11.0 PrivateMessenger for the
instance's primary account. It survives route changes. `createChat` provides the
same pages of 50, four-worker decryption, viewport, references, attachments and
viewer for self and peer chats. Self-chat never publishes remotely. Additional
persona inboxes are not opened; scoped signer/state/store APIs prepare that use.

## Contacts and routes

The directory combines owner kind 3 public and personal lists with the owner's
personal kind 30000 (`d=+zillion:contacts`), in context `''`. Only the override
list is written. The public list refresh uses a 15-second relay budget per
attempt and retries with exponential backoff from 1s up to 5 minutes while no
local public list is known; generic connectivity probes never gate attempts.
When a probe confirms the device is offline, the wait also ends on the next
`onOnline` notification instead of only on the timer. `p` fields are pubkey,
relay hint, petname, label: the label merges every state letter, `r` removes the
contact and wins over `p`, `p` pins it, and absent/empty/unknown values mean an
unpinned contact. Letter order never matters and unknown letters are ignored so
newer writers can add labels without breaking older ones. CRDT decorations are
never relay hints, petnames or labels, and a removed contact is never pinned.
Other entries and their metadata survive edits. Each edit also compacts the
override: a removed entry whose pubkey appears in neither the public nor the
private kind-3 snapshot is dropped, and the store's local CRDT
merge records the omission as a tombstone. While no public snapshot is known,
every override is preserved because the missing list may follow the peer.
Removing a contact keeps history and suspends sending/listening; re-adding
resumes the available recovery interval.

`/chat/user` is self-chat; `/chat/<64-character peer key>` uses the real shared
chat service. `/contacts/add` searches current contacts and resolves complete
NIP-19/NIP-05 identifiers through point profile lookups; profile cache is shared
with home and chat. `/profile/:contactId` persists contact and pin changes.
Pinning persists in the override entry and profile editing remains a local
preview; removing a contact clears its pin.
No bottom navigation is added.

## Delivery and storage

`withSharedKey(peer, 'dm')` derives each stable symmetric channel. The peer is
the only remote recipient. Incoming delivery validates channel, transport sender,
inner identity/signature and provenance, saves a personal copy in `dm:<peer>`,
then acknowledges the persistent reservation. Interrupted saves are redelivered.
Hearsay supplies reference context only, never a new main timeline message or an
authoritative deletion. Matching direct/signed copies take precedence.

Each contact channel uses `mode: 'seeder'` with `seeders: [peer]`. Both Zillion
participants announce seeder presence and retain encrypted router seeds; each
knows the other as its remote recovery seeder from the start. PrivateMessenger
owns immediate/periodic presence, seed storage and automatic recovery replies,
and suspends that work when the channel is removed or the signer is unavailable.
Relay selection still follows the participants' NIP-65 read lists and the
library's existing fallback. Self-chat has no channel. This is a one-to-one
contact policy, not a policy for future group chats.

The outbox uses `libp2r2p/idb-queue`, database
`zillion:outbox:<owner>:idb-queue`, with library-owned `items` and `state` stores
and a unique `byId` index. Item payloads contain only an opaque event ID and
ciphertext; ordering and byte accounting are queue metadata. The plaintext
entry is encrypted via the owner's NIP-44v3 signer using kind 9 and scope
`zillion:outbox`. It records peer, stable inner events, local-save flags, publication
cursor and IRFS chunk progress. No plaintext message or attachment bytes are
stored in this app database. `evictionPolicy: 'reject'` prevents capacity
eviction, with no configured logical byte limit; browser quota failures still
propagate. Atomic `putBy` upserts preserve IDs, and `existingOnly` checkpoints
cannot recreate a cancelled record. Reads use the ID index without consuming
entries. Encryption remains in the app adapter; the library owns storage and
transactions. This replaces the custom store because the queue now supports
the required atomic updates by unique key. The coordinator does not use leases.
No migration or fallback reads are provided for the old `zillion:outbox:<owner>`
database; it may be deleted manually. Closing the coordinator awaits the queue.

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

## Publication diagnostics

Each `delivery.reports` item represents an outer transport event, not a relay.
Every outer event needs acceptance from at least one selected relay; one failed
relay alone does not fail a redundant send. libp2r2p 0.10.26 uses the
30-second operation deadline for publication, returning immediately on the first
accepting relay. The former 3-second first-acknowledgement cutoff is disabled by
default; connection establishment keeps its separate 3-second limit. Missing the
publication deadline is a failure even if the relay is online; it does not prove
that the peer could not receive an event accepted without a timely acknowledgement.

`MESSAGE_NOT_PUBLISHED` keeps its stable `code`. Its message includes failed
report positions, relay counts, URLs, categories and native rejection/timeout
messages. `eventId` and `eventKind` identify the outgoing inner event (including
quoted context or attachment chunks); `reports` retains only failed publication
summaries with the original relay errors and their causes. `reason` distinguishes
`NO_DELIVERY_REPORTS` from `RELAY_PUBLICATION_FAILED`; empty relay sets say
`NO_RELAYS`. Only failed reports await their detailed promise, which the installed
pool settles before returning failure. Successful sends keep the first-ack fast
path. Diagnostics go through the existing console error callback and are not
persisted in the outbox. Never log the complete broadcast result: it contains
plaintext and may include `delivery.deletionSeckey`.

Relay response text does not classify local signer permission failures. Publication
failures remain retryable, preserving the inner ID and committed local copy.
These diagnostics identify future failures; the former generic error cannot
establish the cause of an earlier incident.

## Relay fallback

The published libp2r2p performs fallback inside PrivateMessenger,
shared by text, quoted context, announcements and attachment chunks. For implicit
single-recipient NIP-65 routing, it selects at most two recipient read relays per
attempt and republishes the exact signed outer event to remaining candidates.
One accepting relay completes that outer event immediately. There is no extra
publication solely to replace a failed redundant copy; eligible redundant
failures influence later selections while the healthy relay remains selected.

Only machine-readable policy/server rejections (`blocked`, `restricted`,
`auth-required`, `pow`, `rate-limited`, `error`) and native connection/transport/
timeout failures permit replacement, after `isOnline` confirms connectivity.
Invalid events, local signer/authentication failures and unknown errors retain
their diagnosis. Explicit relay lists remain primary destinations. Candidate lists
are finite; exclusions last five minutes in memory and do not alter subscriptions.

The outbox stays pending while alternatives are tried. Only final failures reach
`onSendError` and Zillion's existing route-instance filter, so the toast for relay
refusals appears only after eligible alternatives are exhausted. Offline work
with remaining alternatives also stays pending and quiet; a temporary shared
`onOnline` listener retries it without overriding signer/account unavailability.
Pause-aware delivery recovery requires libp2r2p 0.11.17 or newer.
Sends attempted while the messenger is paused stay pending without a send-error
toast. The session observes `readStatus`/`onStateChanged`, parks remote publication
and wakes immediately when the relevant pause is released; it does not repeatedly
publish against a known pause. Personal saves and self-chat remain local.
Internally observed network pauses share connectivity monitoring and recover even
without another native online event. Retryable watch failures recover by channel.
Session inbox persistence uses `session-storage`, retries the actual reservation,
and releases after save/ACK, leaving independent storage/account pauses intact.
Operational recovery uses 1..30s exponential backoff with 20% jitter; offline waits
do not advance it. Historical scans/presence are not prerequisites for text sends.
Paused diagnostics include a copied `pauseReasons` array on the error and cause;
no error object or diagnostic is persisted in the outbox.
Cancellation and session close stop further fallback publications.

The controlled browser scenario `tests/browser/send-feedback.browser.js` checks
all five read relays fail before the toast, successful replacement without a toast,
unchanged outer event IDs, the two-recipient-relay limit and inactive retained
routes. The published libp2r2p exposes `fallbackRelays` through both
the messenger and session constructors. Zillion sets it to
`['wss://relay.44billion.net']` in `private-chats.js`. The same signed outer event
is published only after eligible primary failures; no public recipient `p` tag
is introduced. A relay ACK continues to mean publication, not peer receipt.

The fallback is watched from the start alongside the owner's read relays and is
queried during history/file recovery. Healthy primary subscriptions cannot prove
that a sender did not use the fallback. This union also applies to explicit
`relays`; outgoing `relays`/`sendRelays` lists keep their primary role and initial
fanout before configured fallbacks are tried in pairs. NIP-65 lists are unchanged,
and automatic relay-list refreshes retain the fallback. The library also supports
automatic multi-recipient routing and explicit `relayToReceivers` maps, preserving
encrypted subsets and requiring accepted publication covering every recipient.
This does not add group conversations to Zillion.

The browser scenario now also verifies fallback listening with a distinct owner
read relay, quiet successful fallback publication, exhaustion including fallback
before feedback, and unchanged public tags. Validation uses the published
libp2r2p from npm, resolved in the production lockfile; no local archive
or sibling source import is required.

## Recovery diagnostics

`PRIVATE_CHANNEL_FETCH_INCOMPLETE` describes a historical read, independently of
outgoing publication. The current library waits up to 5000ms per admitted relay;
a timeout, early closure or another incomplete outcome keeps the interval pending,
even when other relays returned messages. Successfully ingested messages remain
available. The first watch can scan seven days, so an error near Send need not
belong to that send. Rewatch/resume and relay-list changes can retry pending ranges;
the library also schedules bounded recovery for pending historical ranges,
without treating incomplete scans as confirmed coverage.

The account callback includes a copyable JSON diagnostic in the console message,
with `owner` distinguishing simultaneous instances. It explicitly serializes
non-enumerable `AggregateError.errors` and nested `cause` fields, including native
codes, categories and WebSocket close details. It also retains the original Error
as a separate console argument for stack inspection. A field allowlist excludes
message bodies, signer objects, full messenger results and deletion capabilities;
cyclic/deep causes are bounded. Native error text is retained verbatim.

libp2r2p 0.10.27 adds `code`, `operation`, `request`,
`receivedEventCount`, `elapsedMs`, `relays` and `relayErrors`. Request metadata
identifies channel/receiver, requested time range and the 5000ms timeout; relay
outcomes identify successful as well as incomplete relays. Elapsed time measures
the read (including admission), not decryption/storage. The event count describes
outer transport events, not messages acknowledged by the app. Status-only failures
remain visible even when the aggregate has no native errors.

Subscription transport failures also carry `relay` and
`operation: 'private-channel.subscribe'` with the companion library update.
They preserve the native message, code, category and WebSocket close details;
`cause` retains the original error without mutating it, since a transport error
can be shared by multiple subscriptions. Aggregate errors retain their nested
errors. A missing relay remains unspecified rather than being guessed from the
configured relay list. Delivery and reconnect behavior are unchanged.

**Integration status:** the coordinated update targets libp2r2p 0.11.0, including
historical and subscription diagnostics and the per-file transfer coordinator.
Publish that library release before installing the updated consumers from npm.
Validation uses the locally packed release through its public package exports;
production source contains no sibling-checkout imports or tarball dependencies.

When collecting a recurrence, copy the complete JSON line and stack from both
instances. Compare owners, requested ranges, relay statuses, categories and close
causes before changing timeout or relay policy. One successful relay must not mark
history complete: different relays may retain different events. The generic
original log cannot establish which relay or condition caused this incident.

## Availability and presentation

Signer-state notifications pause/resume inbox network work and outbox sending.
Account lock, read-only, connection and persona access are distinct. Each write
still handles races after notification. Unlock/reconnection recovers history and
retryable outbox work; visible failed preparations retry without repeating known
permission denials. Hearsay quotes show “Unverified” and a native, focus-contained
dialog, bottom-aligned on mobile and centered on desktop, with Escape and focus
restoration. All new labels have eleven translations.

Messenger recovery defaults to seven days and depends on retained relay/seeder
data. The library's recovery-seed cache has a shared 64 MiB FIFO budget, so the
seven-day window does not guarantee that every seed remains available. Recovery
seeds are separate from event-store history and the non-evicting app outbox.
Visited chat pages remain in memory for this session; history is paginated,
not virtualized. Local outbox records survive app closure under the same app/user
origin. Clearing site storage removes that outbox; it is not cross-device sync.

## Demonstrations and validation

`ZILLION_DEMO=1 npm run build` enables bundled fictional contacts/messages with no
real channels or contact writes. The default build has no sample contacts. The
photo promised by the sample conversation is included. Browser fixtures are
separate entry points and never included in published builds.

Node tests cover membership/CRDT selection, ack-after-save, removed-contact
queues, durable retries, encrypted records and symmetric seeder configuration.
Chrome checks seeder presence and retained recovery data in addition to message
delivery. Integration uses the real
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

## Per-file data channels (libp2r2p 0.11)

All IRFS chunks, including thumbnails, travel on
`withSharedKey(peer, 'dm:media:' + root)`. The normal `dm` carries 1063/9 and
small `fileChunksRequest_p5cc` controls; compact `fileChunksReply_p5cc` responses
travel on the corresponding file channel. Upload originals and thumbnails and
confirm each wrapper at a relay before publishing metadata/message. Repeated
messages can reuse the same pair/root; their retaining metadata remains separate.

`private-chats.js` supplies signer and event-store adapters to the library's
account-wide file coordinator. Its two download slots, bounded 16-index batches,
staggered seeders, proof checks and persisted-byte progress are shared by bubbles,
quotes, gallery previews, the viewer and native downloads. Local state is never
an event tag. Resolved reference view models carry `mediaPeer`; `wireEvent`
strips presentation fields before storage/publication. Self-chat remains local.

Automatic originals are at most 1 MiB. Larger/unknown files wait for action and
show download/retry/cancel and progress. A preview uses the advertised thumbnail;
it never fetches a large original to manufacture a thumbnail. Preparation tries
320, 160 and 80 pixel targets until its thumbnail fits one 51,000-byte IRFS block;
if none fits, retain ThumbHash only. Thumbnail chunks also use their own root
channel, and the 1063 includes `thumb` plus an unordered
`['r', root, 'mark thumb', 'size <bytes>']` reference. Both roots are retained by
normal launcher reference counting. Deleting one message does not delete another
message's shared bytes or the independent attachment catalog copy.

The encrypted manual-download queue is
`zillion:downloads:<owner>:idb-queue`, using the idb-queue `items`/`state` stores
and unique `byId` index. Entries contain an opaque hashed ID and NIP-44 ciphertext
(scope `zillion:downloads`, kind 9). Decrypted descriptors remain in memory.
Completion/cancellation removes intent; reload, signer readiness and network
resume retry it. No accepted intent is evicted by an app quota. Partial chunks
remain in launcher storage. Multi-device seed synchronization is deferred.

File seeders store a small durable authorization catalog, not ciphertext copies
of the file. Before publishing each original/thumbnail the outbox calls
`authorizeSeeding` with the recipient and the stable kind-9 timestamp (standalone
1063 uses its own timestamp). A new explicit share renews the grant; replay,
restart and retry do not. The catalog starts empty; no unpublished file-seed
migration is performed. Read failures propagate and missing positions are skipped.

A grant authorizes only that recipient on that control/data channel pair, expires
with parent recovery retention, and never pins the NostrDB root. Recovery serves
available `storage.read` chunks as `irfsChunk_v1` records inside the normal
recipient-encrypted reply. Reconstructed chunks are persisted as local templates,
without attributing them to the original announcer. Direct validated downloads
may authorize their actual local receiver using metadata's stable sharing time;
cache hits and recovery replies never grant the announcer access or renew grants.
Watchtowers retain the existing 64 MiB FIFO of ciphertext and
`routerEnvelopeRow_v1` responses. Ordinary DM recovery is unchanged.


The sender yields between chunks and gives queued text/deletion controls a turn.
Seeder replies run outside the DM dispatcher with bounded reply workers. Manual
intent writes are serialized with cancellation so a late encrypted write cannot
restart a cancelled download. Consumers join an active download without
rescanning the growing local chunk set on each progress notification.

The isolated browser recovery scenario verifies a file above the automatic
threshold, removes its data from the relay, clicks the real download control,
asserts an empty ciphertext-seed store and a catalog below 10 KiB,
and requires verified first/last chunks plus UI completion from local sender chunks:
`node ../../44billion/bin/run-browser-tests.js -- env ZILLION_FILES_ONLY=1 ZILLION_PRIVATE_ONLY=1 ZILLION_MEDIA_SEEDS_ONLY=1 node --test tests/browser/self-chat.browser.js`.


Validation on 2026-09-29 used the prepared libp2r2p 0.11.0 archive through public
exports: 650 library, 157 Zillion, 1,023 launcher and 313 vault Node tests passed.
Changed library source and Zillion lint passed, as did all three application
builds (the vault build used its development output to preserve tracked docs).
Guarded browser runs passed attachment/native-download regressions, the ordinary
two-account chat scenario, and manual recovery of a 1,048,577-byte file after
relay eviction. The last scenario verified sender-local seeds without a sender
file subscription and completed within the 3 GiB limit (2,859 MiB observed peak,
no swap). Three external relay diagnostics also passed; these checks do not
establish public relay retention or availability guarantees. The package and
applications have not been published or deployed by this change.


The follow-up authorization implementation on 2026-09-29 passed 658 library,
158 Zillion, 1,023 launcher and 313 vault Node tests. The guarded private-media
browser scenario recovered the >1 MiB original after relay eviction using local
chunks, confirmed zero file ciphertext seeds and a catalog below 10,000 bytes,
and completed with a 2,592 MiB peak (3,072 MiB cap, no swap). Three public-relay
read diagnostics passed via the 44billion relay; another diagnostic relay was
unavailable. These runs used the prepared, still unpublished 0.11.0 archive.
There is no legacy file-seed conversion.

## Shared session and synchronized recovery (0.11.1)

`private-chats.js` composes `libp2r2p/private-messenger/session` with the library's
`private-messenger/event-store` adapters. The session owns transport scheduling,
ACK-after-persistence, staged upload/retry and manual download resumption; Zillion
owns account availability and media presentation. Existing encrypted outbox and
download-intent stores retain their names/scopes and pending work.

Seeds and file grants are self-authored kind-30078 personal copies in context ''.
NostrDB synchronization can transfer these records along with existing chunks.
A paired device needs channel configuration and available chunks to serve grants;
a watchtower only needs preserved ciphertext. Requests and replies keep their
current DM/file channels. No local-to-personal-copy seed migration is performed.

The library codecs define immutable unversioned coordinates, obfuscated selectors
and daily D candidates. Grants never use r root references. Revocation is private
kind 5; local removal/expiry is not a distributed deletion. Sync never renews a
share. The vault's own synchronization messenger retains local seeds to avoid a
recursive sync loop. NostrDB quota, signer lock and storage errors remain visible.
