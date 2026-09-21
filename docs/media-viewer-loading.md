# Media viewer pagination and resource ownership

## Sources and ordering

The production self-chat reader uses the account's injected event store and
signer, through `createSelfChat.createMediaReader`. Each session belongs to one
`dm:<peer>` context. Fixture DMs use an in-memory reader and never query the
owner's files. Profile photos are a separate one-item view.

Files qualify by their exact `m` mirror in a kind-1006 wrapper's `o` tags.
`helpers/viewer-media.js` owns the shared allowlist for counts and pages. The
list includes common image/video formats plus native formats supported by only
some browsers (for example [Safari HEIC/JPEG XL](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)).
Container support still depends on codecs and platform; see the
[Chromium MIME implementation](https://github.com/chromium/chromium/blob/main/media/base/mime_util_internal.cc).
There is no wildcard query on obfuscated MIME values. Audio-only types and
`application/*` streaming playlists are outside this viewer's image/video set.
Invalid metadata and unsupported codecs remain counted unavailable items.

Orphans and download-intent 1063 files participate. Original chat download links
keep their existing behavior. URLs come only from loaded kind-9 messages at
session opening. Their descriptors, not whole messages or decoded bytes, are
snapshotted until closing. No additional history or relay reads occur. Deletion
envelopes can remove occurrences belonging to deleted messages; chat unloading
alone must not change that snapshot. Quotes and download-intent direct URLs
remain excluded. A file reference is not counted twice as a URL occurrence.

Order is ascending `created_at`, descending wrapper ID for files / message ID
for URLs, then content position. A file is not joined to unloaded kind 9s.
Repeated sends of one root are distinct occurrences. Counts select exactly the
same wrapper set as pages; they avoid client decryption, but the underlying
store can still scan IDs. Invalid counted wrappers are not silently skipped.

## Reader contract and bounds

`createConversationMediaReader` accepts owner, signer, event store, context,
URL descriptors and invalidation/error callbacks. `open(id)`, `move(step)` and
`refresh()` return `{ current, previous, next, index, total }`. `close()` is
idempotent. The reader serializes operations; the view separately ignores stale
requests. IDs use `file:<inner-id>`, with `copy:<wrapper-id>` for unreadable
wrappers; direct URLs retain their message/slot identity. File lookup uses the
source-ID mirror AND the MIME filter. A missing URL route does not trigger a
message search.

Metadata queries request three events at a time and cache at most 12 descriptors.
Initial ordinal uses a count before the timestamp and rank in the same-second
group. Time filters are inclusive, so tied groups use ID-only queries of 200
with exclusions, sorted locally. At most three timestamp groups remain cached;
a pathological burst can therefore consume memory proportional to its IDs.
This avoids fetching/decrypting the entire group's content. Closing clears all
session caches. Live changes invalidate count and pages, keeping selection by
ID, then selecting next or previous if deleted. No launcher API changes are
required.

Three reusable component slots retain only previous/current/next sources. Each
slot also reuses its image and video DOM elements across loading/error states;
removing and recreating an image for each source can retain detached ref nodes.
Hash-only route changes keep the same reader session and URL snapshot.
Native load/error listeners belong to a source assignment and are removed before
unloading it. They verify the current source and decoder state: late events from
an empty image or inactive video cannot hide Loading or fail a replacement item.
A failed neighbor is retried once on selection, including transient metadata
decryption failures. No automatic failure loop or unbounded retry is introduced.
A locally pending kind-9 attachment shows Loading while its 1063 is not yet
committed; settlement triggers a new lookup, and missing items offer Retry.
Counts still include only persisted eligible wrappers and the URL snapshot.
Neighbor images can be prepared; neighbor videos acquire only already cached
posters. They never start a decoder or fetch a playable video source. Only the
current video can play. Cleanup aborts work, unloads video, clears image sources
(including detached template nodes), releases poster leases and drops data URLs.
Inactive chat images retain dimensions but release sources so route retention
preserves geometry without keeping their originals decoded.

Persistent `media-cache` (64 MiB), avatar cache (16 MiB) and attachment previews
(8 MiB / 128 entries) remain separate owners. These budgets do not bound browser
RAM or GPU memory. A single huge original can still be expensive. The guarantee
is bounded viewer resource ownership, not a fixed process-memory ceiling.

## Validation

Unit coverage exercises matching count/page filters, context isolation, orphan
and download files, bounded decryption, 213 tied timestamps traversed both ways,
URL snapshots, missing selections, invalid metadata, deletion and cleanup.
Chrome coverage uses the real launcher, vault and event store, includes retained
chat state and native video controls, and traverses 60 orphan files while
checking fixed slots, cleared sources and DOM growth after garbage collection.
Run Chrome only through the project's 3 GiB guarded runner, one suite at a time.

New states reuse the existing translated Media unavailable, Loading media,
Retry and Download file strings; the eleven-locale catalogs remain unchanged.
No kind-9 pagination, URL index, additional tags or relay discovery is added.

## Measured validation (2026-09-21)

- ESLint, production build and all 119 Node tests passed.
- The guarded Chrome viewer suite passed routing, retained draft/scroll, native
  controls, horizontal/vertical touch, reduced motion, light/dark at 320/1000px,
  file reopening after reload without its message, deletion, offline cached
  images, rapid hash replacement and uninterrupted video during live updates.
- Across 60 orphan files, the viewer kept three component/DOM slots and at most
  three source-bearing assets. Application-realm image nodes were 50 before and
  51 after (also after a 16-second settling interval); source-bearing image
  nodes were 30 both times, including unrelated retained application UI.
  Closing cleared every viewer image/video source. This caught and fixed both
  per-item template retention and detached images recreated during loading.
- The complete viewer test tree peaked at 2469 MiB under the 3072 MiB no-swap
  guard. This includes Node, launcher, vault and Chrome, not just the viewer.
- The profile regression passed separately, peaking at 1472 MiB.
- The complete focused attachment regression passed (native local video,
  downloads, gallery recovery, locked-vault retry, compression, scoped deletion
  and offline reload), peaking at 2571 MiB. Existing attachment assertions now
  select the current slot explicitly instead of the first preloaded asset.

These are controlled Chrome fixtures, not measurements of arbitrary large files,
Safari/Firefox codecs, mobile native decoder memory or a fixed application RAM
ceiling. Same-second ID groups and the loaded-URL snapshot have separate metadata
costs described above.

## Intermittent-load regression coverage

The real-send/backward-navigation scenario reproduced a blank viewport before
fault injection: the image was complete with nonzero natural dimensions, but
its `.viewer-slide` ancestor still computed to `visibility: hidden` while the
viewer route was visible. Canceling the animation alone did not resolve it;
detaching its effect on completion/cleanup did, without recreating media nodes. Readiness assertions
check computed visibility as well as the selected ID and decoder state.

The reader test injects a temporary decryption failure during neighbor prefetch
and verifies recovery on selection; it fails against the previous reader.
Chrome holds an image response while delivering late load/error notifications,
checks that Loading remains visible, and then releases the real response. A
neighbor that initially receives HTTP 503 must recover on selection. A staged
pending message is opened before its file is committed through the real event
store and must transition from Loading to its original image without reopening.
The existing real attachment tests also exercise new sends followed by backward
navigation; readiness checks include source, decoder state and visibility.
