# Local attachment validation

Validated on 2026-09-14 against the local 44billion/ez-vault runtime, using
Chrome desktop in headless mode and disposable browser profiles. External
HTTP/WebSocket traffic is denied by the test proxy; media fixtures are served
through Chrome interception. No production publication or relay upload ran.

## Automated checks

- `libp2r2p`: full Node suite (43 test files). New IRFS checks reconstruct exact
  bytes at chunk boundaries, validate roots/proofs, repeat iteration for retry,
  reject empty input, cancel preparation/iteration and release owned resources.
  NIP-94 checks transport captions, dimensions and ThumbHash intact, reject
  malformed metadata and preserve near-limit nfile URLs and `localOnly=1`.
- Launcher: full Node suite (874 tests), including personal-copy chunk
  normalization, retention through an owner's wrapper around another author's
  metadata, local-only loading, missing bytes, ranges, HEAD and cancellation.
  New helpers test strict download URL validation and bounded read demand.
  The Chrome bridge suite covers shared windows/widgets, navigation, closing,
  reopening, handshake retries, identity/persona scopes and cold origin cleanup.
- Zillion: full Node suite (10 test files), including failed/unsupported image
  preparation, exact bytes, cancellation, partial chunk refusal, retry of only
  missing chunks with the same event ID/time, metadata-only reuse and catalogs.
- Focused Chrome integration (`npm run test:browser:attachments`) installs the
  production build locally, with future-feature controls disabled. The paperclip
  opens the single-file native picker; preparation/removal do not send a message;
  an empty caption works; a 102,003-byte file is saved and downloaded through
  Chrome's actual download manager. The resulting filename and disk bytes are
  checked. The link targets a named iframe; no download Blob is created.
- The same Chrome integration checks direct local image rendering, a decodable
  WebM video generated from canvas, real image/video dimensions and ThumbHash,
  latest-first gallery order and root deduplication, caption compaction, reply
  thumbnails and `q` references. Binary-file replies keep the filename without
  fetching the file as a web preview. Blocking the real vault produces an error;
  unlocking and Retry confirms the same event. Metadata and image bytes reopen
  offline after reloading the app document.
- Download checks exercise HEAD, cross-chunk ranges, missing files, a stale
  instance marker, reader cancellation and a stopped/restarted service worker.
  Router unit tests confirm that a known bridge never falls back to another
  ready bridge. Local nfile requests do not escape to the external network.

The complete self-chat Chrome regression also passed
(`node --test tests/browser/self-chat.browser.js`, about 212 seconds). It includes
text/outbox behavior, Nostr preview privacy, captions/replies and the attachment
scenarios, followed by staged history enrichment, bottom pinning without initial
animation, preservation of a reading anchor, overlapping growth, reduced motion
and Back/Forward retention of scroll position. History checks track message IDs
and the inserted fixtures rather than transient global counts during routing.

Lint passes for changed library/launcher code and the whole Zillion checkout.
Production builds are generated locally for the launcher and Zillion. Zillion
consumes the packaged `vendor/libp2r2p-0.10.18.tgz`, not sibling source imports.
The development watcher installs the Zillion build into the local launcher.

## Coverage limits

No Android device was connected (`adb devices -l` returned an empty list).
Physical mobile pickers/keyboards and Safari/iOS were not exercised. Firefox is
installed, but was not exercised by the Chrome CDP integration harness.
Chrome uses the real native download
implementation, but its visible download-manager UI was not inspected manually.
The multi-bridge isolation invariant is covered by router tests plus a real
stale-marker rejection; simultaneous downloads in two independent browser tabs
remain a manual check. No large-file memory benchmark or new quota policy is
part of this change. The in-memory MMR tree scales with the number of chunks;
file bytes are read in bounded slices, and downloads use a backpressured stream.

Drafts and pending/failed outbox entries intentionally do not survive a reload.
Confirmed files depend on the launcher's existing retention. Closing the owning
instance can interrupt downloads; nostr.alt links are not promised outside it.

On stopping the owned development watcher with Ctrl+C, existing supervisor
children logged `ERR_IPC_DISCONNECTED` during shutdown. This occurred after all
validation completed; the shutdown code was not changed as part of attachments.

See [the 2026-09-15 follow-up](download-intent-and-memory-validation.md) for
download intent, browser memory findings and the guarded test runner.
