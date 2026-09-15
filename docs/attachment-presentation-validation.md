# Attachment presentation validation

Validated locally on 2026-09-15. No production publication and no launcher API
or source changes were required.

## Checks

- Node suite: 57 passing tests, including filename priority (name, r, ox, x,
  translated generic), extension inference, UTF-8 limits, immutable derived
  nfile URLs, decimal sizes/locales and extreme media geometry.
- The guarded Chrome attachment suite passed against the real local launcher
  and vault in a disposable profile. It covers file selection/removal, gallery
  expansion and reuse, preparation ownership, locked-vault retry, reload,
  native downloads, download intent, service-worker restart and local misses.
- Added browser checks cover composer fallback categories (audio, text and
  failed image), square gallery-cell sizing at 320/390/1024px viewport widths,
  light/dark themes, full accessible filenames with clipped basenames, internal
  remove controls, and actual 1x2048 / 2048x1 images. Media and download rows
  remain bounded; contained previews do not crop content.
- Replies to a file with a caption contain the extension-preserving filename
  before the caption in both composer and posted quote. Narrow quote geometry
  and bottom-following after viewport-height changes are asserted.
- A received nfile without a filename downloads with root.pdf and the exact
  original bytes through Chrome's real download manager, offline. The existing
  launcher API receives a derived nfile URL; no Blob download is introduced.
- Visual review of the composer screenshots confirmed readable overlays and
  the category fallback in both themes at a narrow viewport.

## Memory and test isolation

The final successful browser run took 55 seconds and reported an observed cgroup
peak of 2000 MiB. The complete process group had a 3072 MiB hard limit and zero
swap. The pre-existing development runtime was paused before testing; the guard
refused to reuse it outside its memory group. Browser profiles and child processes
are cleaned up by the existing harness.

The old download-intent fixture now waits for its exact event ID instead of
assuming every newly rendered history row belongs to the newly inserted event.
Selection/gallery checks wait for asynchronously rendered component controls.

## Limits

Chrome desktop performed the validation, including emulated narrow viewports and
keyboard-sized viewport changes. A physical mobile keyboard, mobile browser and
other browser engines were not exercised. This run does not establish the cause
of previous machine freezes or reproduce device-specific scroll jitter.


## Follow-up: inline replies and ellipsis

The guarded Chrome suite also passed after correcting the reply's inline flow
and composer order. Range measurements group text fragments into visual lines
and verify that explicit and automatic line breaks restart at the reply's left
edge, in both composer and posted quote. Filename checks cover shrinking and
widening a label: the extension dot disappears only while the basename is
ellipsized and returns when the complete name fits, without changing download
names. Composer DOM order is reply, selected attachment, then open gallery.

This follow-up run took 56 seconds with an observed cgroup peak of 2014 MiB,
under the same 3072 MiB limit with zero swap. Lint and the Node suite also passed.


## Follow-up: contiguous filename labels

Filename fitting now measures and renders one text run instead of combining
native text-overflow with a separately positioned extension. Node tests cover
fitting and grapheme preservation. Chrome Range measurements verify adjacent
ellipsis/extension character positions (less than 0.1px gap) across the tested
viewport sizes and themes. Full names, resize recovery, inline reply flow and
native downloads continue to pass. The successful guarded run took 56 seconds
with a 1996 MiB observed peak and no swap. Lint and all Node tests passed.

## Follow-up: preparation control

The preparation status uses a 24px opaque rounded cancel button with a 16px icon,
placed left of the separate live status. Chrome verifies its size, alignment,
keyboard focus, disabled Send state, cancellation and caption preservation using
a sparse 128 MiB fixture without allocating a file-sized test buffer. The fixture
is canceled during hashing; this is not a full-file preparation memory benchmark.
The guarded attachment suite passed in 56 seconds with a 1967 MiB observed peak,
a 3072 MiB hard limit and zero swap. Lint also passed.
