# Attachment gallery recovery and stability

Validated on Linux / desktop Chrome in the real local 44billion launcher,
September 2026. No production publication or launcher/library API changes.

## Behavior and ownership

The account exposes one internal, coalesced recovery operation. The clip and both
Retry controls reuse it. Recovery rechecks launcher identity and replaces the
history subscription without replacing the same account's self-chat service or
outbox. Generation checks reject obsolete stream/decryption results. Account
changes and root teardown still close their old service and temporary resources.

Catalog state distinguishes loading, loaded and unavailable. Initial decryption
must finish before partial results become a gallery catalog. Known media opens
immediately; confirmed empty history opens the picker. Unknown/unavailable
history opens add-file plus three shimmer tiles, then media or a Retry tile.
Reduced motion keeps the placeholders static. An empty asynchronous result leaves
add-file alone, and a late result never opens a panel the user already closed.

The disposable preview FIFO still holds at most 8 MiB / 128 entries. Each entry
owns one stable object URL, acquired synchronously for cache hits. Consumers own
independent leases. Replacing/evicting an entry removes it from the FIFO but does
not revoke its URL until its last active lease closes. Uninterested cold work is
canceled; a later attempt can start again. Gallery rendering checks live leases
rather than restoring obsolete URL strings, and ignores stale media completions.
Cold previews remain visibility-gated; no persistence or HTTP cache was added.

## Validation

- Node suite: 77 tests passed. New coverage includes shared recovery, decryption
  completion, preserved failed outbox/event identity, replacement subscriptions,
  stale decryption after teardown, synchronous cache leases, stable URLs,
  replacement/entry-count/byte eviction and cancellation of shared cold work.
- Real vault scenarios: start with existing attachments while locked, persistent
  failure, unlock and recover through gallery Retry, a second cold locked start
  recovered by the clip, repeated concurrent requests, and close before completion.
  Conversation Retry preserves a failed compressed MP3 attachment, which then
  saves with the same message ID without another encoder/preview run.
- Frame sampling: three cached reopens, eight mounted-tile frames each, plus
  twelve frames after a newly saved message. No sampled frame reverted to an
  icon or undecoded image; URL unchanged, zero original reads, zero new Workers.
- Controlled UI states run alongside the real app (without replacing launcher
  providers): three running shimmer animations, reduced-motion static state,
  only add-file/Retry after failure, native Enter activation, empty result without
  an unsolicited picker, reopen retry and late empty completion staying closed.
- The complete self-chat browser regression passed in 204 seconds, including
  native downloads, offline reopening, attachment/reply presentation, history
  pinning, reading anchors, overlapping growth, reduced motion and retained routes.
  The guarded process tree peaked at **2471 MiB**, with **0 swap**.
- The normal watcher build was installed and opened in the real launcher; home
  and self chat rendered, and the test-only state export was absent. This smoke
  check peaked at **1513 MiB**, also with 0 swap. The watcher was restored afterward.
- Final `npm test` (77 tests), `npm run lint`, `npm run build` and
  `git diff --check` passed. README, AGENTS and all 11 locale catalogs are current.

Commands:

```sh
npm test
npm run lint
npm run build
node ../../44billion/bin/run-browser-tests.js -- node --test --test-concurrency=1 tests/browser/self-chat.browser.js
```

For the small controlled gallery UI scenario alone, pass environment flags inside
(the runner's existing environment allowlist remains unchanged):

```sh
node ../../44billion/bin/run-browser-tests.js -- env ZILLION_FILES_ONLY=1 ZILLION_GALLERY_UI_ONLY=1 node --test tests/browser/self-chat.browser.js
```

Browser runs are sequential through the existing systemd runner with a 3072 MiB
hard limit and swap disabled. The test-only fixture exposes account state for
assertions; it is excluded from normal builds. Frame checks sample actual rendered
thumbnail readiness with requestAnimationFrame, not just the eventual DOM state.

## Limits

Physical mobile devices, Safari and Firefox were not exercised. The sampled
Chrome frames verify this regression under the tested runtime; they are not a
claim about every device/compositor. Cache limits apply to retained compressed
preview entries; active leases can temporarily keep evicted entries alive until
release. Reload still discards drafts, pending/error outbox entries and this
in-memory preview cache. Confirmed files remain in launcher storage.

## Single-row loading follow-up

Loading now uses three placeholders beside add-file. The focused real-launcher
UI test verifies that all four items share one row and that panel height stays
identical through loading, failure and keyboard Retry at 390px container width.
Reduced motion and empty-result behavior also pass. Lint and production build
pass; this guarded browser run peaked at 1380 MiB with no swap.

## Minimum recovery display follow-up

Each gallery recovery holds its three loading placeholders for at least two
seconds from their DOM insertion, even if the result arrives sooner. A small
component-owned observer waits for actual placeholder insertion before starting
the timer. Only presentation waits; shared history/account work is unchanged.
Longer queries retain the loading state until they settle. Close, route departure
and unmount clean up the observer, animation-frame request and timer.

The focused real-launcher UI scenario passes with a MutationObserver measurement
of at least 2000ms between placeholder insertion and removal after quick failure.
It also checks stable height, keyboard Retry, quick empty success, reduced motion
and closing before expiry without reopening afterward. The guarded run took
16 seconds and peaked at 1414 MiB with no swap; lint and production build pass.
