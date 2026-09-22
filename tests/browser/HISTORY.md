# Incremental history regression

Run from Zillion with the shared guarded Chrome runner:

```sh
node ../../44billion/bin/run-browser-tests.js -- node tests/browser/self-chat.browser.js --history-only
```

It creates 235 personal copies through the real launcher/vault, sharing one
second, then reloads and asserts an opening of 50. It checks a maximum of four
concurrent decryptions, no separate initial query, scrolling/anchor preservation,
all pages without duplication, draft/route retention and deletion/recovery.
The account/profile is disposable; external network traffic stays blocked.
`--skip-measurement` skips only the diagnostic comparison when repeating the
navigation assertions. Unit tests cover failed pages, transient decryption,
malformed plaintext and recovery gaps larger than the initial page.

Measurement on Chrome in the protected 3 GiB group (2026-09-22):

| Stage | Paged opening (50) | Serial query/decrypt baseline (200) |
| --- | ---: | ---: |
| Snapshot delivery / query | 12.6 ms | 68.7 ms |
| Decryption calls | 50 | 200 |
| Maximum outstanding decryptions | 4 | 1 |
| Service opening | 12.88 s | 53.91 s |
| Message-list callbacks | 1 | Not rendered in baseline |

This compares the current service with the old query-then-sequential-decrypt
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

Final protected Chrome runs passed for the 235-event history, media viewer,
attachment matrix, text/scroll matrix, real IndexedDB quotas/removal and app
bridge. The split self-chat groups peaked at 2588 MiB and 2442 MiB respectively;
the 3 GiB cap and disabled swap were unchanged.
