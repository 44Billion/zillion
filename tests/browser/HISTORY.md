# Incremental history regression

Run from Zillion with the shared guarded Chrome runner:

```sh
node ../../44billion/bin/run-browser-tests.js -- node tests/browser/self-chat.browser.js --history-only
```

It creates 235 personal copies through the real launcher/vault, sharing one
second, then reloads and asserts an opening of 25. It checks scrolling/anchor
preservation, all pages without duplication, draft/route retention and deletion/
recovery. The diagnostic comparison reads the same 25-message page with limits
of 4, 8 and 16 outstanding decryptions, twice in opposite order; production keeps
four. It waits for the home summary reader to finish first to avoid measuring
that independent workload. This measures real API/history work, not DOM rendering.

The test-only paging control holds the account's UI `loadOlder` requests until
the opening assertion completes. A first page may already be near the top and
otherwise prefetch another page before the assertion runs. For the anchor check,
arm the control, move into the near-top region and verify a real UI request is
waiting. Wait for fonts, native scroll handling and repeated stable rendered
geometry before capturing the controller's first readable row. Assert the viewport
is actually away from the bottom: assigning 80% of viewport height can clamp to
the bottom when the first page is only slightly taller, correctly retaining
bottom-following instead of a reading anchor. Release exactly one page, settle again,
then require 50 messages and less than three pixels of anchor drift. Load the
remaining pages explicitly through the original method and restore the UI method
in `finally`. No signer, event-store or permission provider is replaced. Both
measurement modes exercise these same assertions without fixed sleeps.

The text/scroll matrix also waits for rendered geometry after changing the reply
selection. Horizontal-overflow assertions compare `scrollWidth` to `clientWidth`,
not a bounding box that includes borders. Its permission-denial scenario revokes
both broad and kind-9 personal grants after the previous native modal closes.
It checks the current optimistic-send contract: a pending bubble frees the
composer before encrypted admission, denial leaves that identity retryable, and
Retry preserves both the ID and a newer composer draft.

Validation on 2026-10-20: both final history modes passed all 235-message,
same-second pagination, draft, retained-route and deletion assertions. Anchor
drift was 0.046875 px with measurements and 0.34375 px without measurements,
below the unchanged 3 px limit. Protected cgroup peaks were 2818 MiB and
2683 MiB. The text/scroll group also passed at 2100 MiB. Each run used a fresh
profile, the unchanged 3 GiB cap and zero swap; these observations are regression
checks, not a production latency or cross-machine stability guarantee.
The full private-chat group also passed at 1942 MiB, including real permission
grants, relay failure, reload/resume and the terminal revoked signer snapshot.
Select that scenario inside the guarded command so its environment is preserved:

```sh
node ../../44billion/bin/run-browser-tests.js -- env ZILLION_PRIVATE_ONLY=1 node tests/browser/self-chat.browser.js
```
`home-summaries.browser.js` additionally holds EOSE delivery in the real bridge
and verifies that self/peer bubbles appear before it, while readiness stays false.
The account/profile is disposable; external network traffic stays blocked.
`--skip-measurement` skips only the diagnostic comparison when repeating the
navigation assertions. Unit tests cover failed pages, transient decryption,
malformed plaintext and recovery gaps larger than the initial page.

Progressive-loading comparison on 2026-09-30, using the real local vault and
launcher, with the summary reader idle. Each limit reads the same 25-message
page twice, in the order 4, 8, 16, 16, 8, 4:

| Outstanding decryptions | Page completion, run 1 / run 2 | Mean completion | First message callback, run 1 / run 2 |
| --- | ---: | ---: | ---: |
| 4 | 6.443 s / 6.513 s | 6.478 s | 238 ms / 441 ms |
| 8 | 6.534 s / 6.764 s | 6.649 s | 422 ms / 425 ms |
| 16 | 7.645 s / 6.981 s | 7.313 s | 494 ms / 447 ms |

All runs decrypted 25 copies and issued no separate initial query. Snapshot
arrival took 14–34 ms. The progressive path delivered 25 message-list callbacks
per run; callbacks are coalesced per animation frame, but these decryptions
settled far enough apart to publish separately. Higher concurrency did not
improve this sample, so production retains four outstanding operations. This
is a small local comparison, not a guarantee for other devices or remote signers.
The shared 3 GiB guard bounds the whole run; it does not isolate per-limit peak
memory, so these timings do not quantify memory growth from extra concurrency.
The full 235-event pagination/measurement run passed at a 2528 MiB group peak;
the held-EOSE self/peer scenario passed at 2161 MiB. The text geometry regression
passed at widths/scales 390/1, 718/1.25 and 320/2, with a 2317 MiB peak. Its test
build disables source maps: the preceding run with maps hit the unchanged
3072 MiB guard before completing. Production build behavior is unchanged.

Historical measurement before progressive loading (Chrome, protected 3 GiB group, 2026-09-22):

| Stage | Paged opening (50) | Serial query/decrypt baseline (200) |
| --- | ---: | ---: |
| Snapshot delivery / query | 12.6 ms | 68.7 ms |
| Decryption calls | 50 | 200 |
| Maximum outstanding decryptions | 4 | 1 |
| Service opening | 12.88 s | 53.91 s |
| Message-list callbacks | 1 | Not rendered in baseline |

This historical run compared the then-current service with the old query-then-sequential-decrypt
path, through the same real APIs. The baseline uses the event store's default
200-result cap, omits the old overlapping replay, and does not benchmark DOM
rendering. Snapshot delivery includes database, authorization and bridge time;
it is not isolated IndexedDB time. Summed decryption-call durations overlap in
the paged run and must not be interpreted as wall time. The remaining opening
time is predominantly vault work; four outstanding calls do not imply four
parallel cryptographic workers inside the vault. DOM stability is asserted
separately during insertion and navigation.

Pages already visited remain in memory. This version does not virtualize DOM
nodes or bound memory after traversing the whole conversation.

The focused scroll regression can be repeated with `--scroll-only` in place of
`--history-only`. It uses more than one page, lazy image preparation, an anchored
visible message, explicit loading of older backfills, reduced motion and retained
route navigation. The integrated self-chat suite also covers real attachment
uploads, downloads, quotes, deletion and catalog reuse. Viewer regression covers
new sends followed by backward navigation; its reused animation layer explicitly
owns route visibility to avoid retaining Chromium's inherited hidden state.

For the existing text/attachment matrix, split disposable browser runs to keep
both below the unchanged 3 GiB cap (the monolithic run can exceed it):

```sh
ZILLION_FILES_ONLY=1 node ../../44billion/bin/run-browser-tests.js -- node --test tests/browser/self-chat.browser.js
ZILLION_SKIP_GALLERY_UI=1 node ../../44billion/bin/run-browser-tests.js -- node tests/browser/self-chat.browser.js --skip-attachments
```

The first run retains attachments, ordering and file deletion; the second retains
text, quotes, scrolling, pagination-aware reload and ordering. The separate
history and viewer suites cover the long sequence and viewer lifecycle.

The isolated text/scroll run also measured **234 ms** from the first rendered
frame containing bubbles to the viewport's initial settled state (48 loaded
messages, 2026-09-22). This is a separate visual-phase measurement: the fixture
uses controlled image responses delayed by 150–300 ms, includes asynchronous
media preparation, and is not a CPU-only benchmark or a before/after DOM
comparison. The service comparison above isolates the history-loading path.

That earlier validation passed for the 235-event history, media viewer,
attachment matrix, text/scroll matrix, real IndexedDB quotas/removal and app
bridge. The split self-chat groups peaked at 2588 MiB and 2442 MiB respectively;
the 3 GiB cap and disabled swap were unchanged.
