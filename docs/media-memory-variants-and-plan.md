# Media variants, compression compatibility and proposed implementation

Investigation completed on 2026-09-15, Chrome 153.0.8010.36/Linux. This extends
[the initial memory experiments](media-memory-experiments.md). Production code,
application dependencies, launcher APIs and deployed builds are unchanged.
The reproducible local sources, fixtures and raw results are in the ignored
[`tmp/media-memory-variants`](../tmp/media-memory-variants/README.md) directory.
It is not a committed regression suite; preserve it separately when moving hosts.

## Method

One protected browser suite at a time, 3 GiB for the entire process tree, zero
swap, no forced GC. Browser-side Worker creation throws. The largest reported
whole-suite peak was about 1.3 GiB; no OOM or swap occurred. Node sampled cgroup
memory.current every 10ms; tables report MiB added above pre-operation baseline,
including native/shared/file-backed memory. These are measurements on one host,
not browser-independent ceilings. Fixture tools (Pillow, FFmpeg, cjpeg) run only
on the test side, never as an app processing path.

## Remaining variants tested

The image matrix contains 61 fixtures. Old and extended prototypes were compared
against native small-image decoding. Failures are useful results, not passed
production support:

- PNG: every legal color/depth combination (gray, RGB, indexed, gray+alpha, RGBA;
  1/2/4/8/16 bits as applicable), each noninterlaced and Adam7; palette/tRNS,
  AdobeRGB ICC, APNG first/default frame, truncation and invalid critical CRC.
  The old prototype rejected most variants and accepted the invalid CRC. The
  extended row prototype handled all valid matrix PNGs, rejected bad CRC and
  truncation, and matched the 8-bit references including the ICC fixture. The
  16-bit references had mean channel differences up to 1.10/255; this is not
  pixel-perfect conversion. Full APNG composition and fuzz coverage remain open.
- JPEG: baseline/progressive; 4:4:4, 4:2:2, 4:2:0; EXIF orientations 1–8; restart
  markers; grayscale; CMYK with/without FOGRA39 ICC; RGB ICC; noninterleaved
  initial progressive DC scans; truncated header/tail. Native ImageDecoder
  handled the valid small fixtures, including orientation and color. The DC-only
  prototype failed gray/CMYK/restarts/noninterleaved scans and mishandled EXIF/ICC.
  It is not ready to replace a general decoder and must not feed compression.
- GIF animation, WebP lossy/lossless and AVIF: first-frame decoding worked for the
  small fixtures. Large native decoding did not honor requested output dimensions.
- Video: AVC including B-frames, VP9, AV1, rotation 90 degrees, non-square pixels,
  VP9 alpha, HEVC 8/10-bit and truncated MP4. AVC/VP9/AV1, rotation and sample
  aspect ratio worked. HEVC could not decode in WebCodecs OR native video on this
  host; this is a platform limitation, not a proven app regression.
- CanvasSink and a raw decoder disagreed on incomplete color metadata. Matching
  MediaBunny's complete colorSpace defaults removed the ordinary fixture mismatch;
  this does not justify blindly overwriting explicit source color information.
- MediaBunny 1.56.3 creates Workers for color/alpha merging. A separate two-decoder
  experiment merged the reduced color and alpha on the main thread and matched
  native RGBA `[255, 0, 0, 63]`. This validates that fixture, not every alpha format.

### Additional image memory

| Path | 16.8 MP | 67.1 MP | 268.4 MP |
| --- | ---: | ---: | ---: |
| Native JPEG grayscale, supported 1/8 scale | 2 | 8 | — |
| Native JPEG CMYK, supported 1/8 scale | 3 | 11 | — |
| Native JPEG with restart markers, supported 1/8 scale | 3 | 9 | — |
| Native WebP lossless, requested 320px | 149 | 608 | — |
| Native AVIF, requested 320px | 146 | 586 | — |
| Native GIF, requested 320px | 152 | 609 | — |
| Row PNG, Adam7 indexed 4-bit, 320px output | — | 28 | 38 |
| Row PNG, Adam7 gray 16-bit, 320px output | — | 36 | — |
| Row PNG, Adam7 indexed 4-bit, 1080px output + JPEG 0.7 | — | 75 | 77 |

The 268MP PNG took about 3.0 seconds for a 320px thumbnail and 3.1 seconds for a
1080px JPEG. The large files are synthetic; quality validation on photographs is
still required. Supported reduced JPEG decode is discrete: requesting 320px for
these large JPEGs failed; requesting 1/8 (512 or 1024px), then reducing the small
result, worked. Progressive JPEG's approximately 197 MiB at 67MP from the first
investigation still applies. No universal low-memory image backend is established.

## What the proposed future compression defaults mean

Reviewed nostr-compress commit
[`c9e74236c34aa1efe94668ce0c45cc5ca5fbbe6a`](https://github.com/iefanx/nostr-compress)
(source links are listed below).

- Initial UI quality is medium, resolution 1080. Input selection changes the
  resolution to 1080/720/480 based on input height. Automatic video preference is
  HEVC, AV1, VP9, AVC, depending on encoder support. These are UI policies, not
  constants of the compressor functions.
- Image: JPEG quality 0.7, maximum dimension from settings, no upscaling. JPEG
  output removes alpha/animation; no explicit transparency matte is chosen by
  that implementation. Copying EXIF through file-sized DataURLs is unsuitable.
- Audio: MP3 on selection, 128 kbps at medium quality. The source uses MediaBunny's
  MP3/AAC/FLAC extensions and BufferTarget. The tested MP3 extension creates a
  Worker and therefore fails the user's constraint.
- Video: settings.resolution is output WIDTH; bitrate uses an estimated 16:9
  height and 30fps, with medium factor 0.22. Width 1080 gives about 4.33 Mbps.
  This estimate does not itself impose 30fps. Keyframe interval is 2s, audio uses
  QUALITY_MEDIUM, and extra contrast/saturation filters are not used at medium.
- Default removal of sensitive metadata is true. Orientation/color must be applied
  to pixels before removing metadata that affects presentation. Alpha, animation,
  HDR, audio preservation and avoiding upscaling require explicit future policy.

These settings can be modeled without copying the same implementation or silently
adopting its width/height quirks. The actual compression option stays disabled.

## Compression experiments

Outputs used asynchronous OPFS createWritable plus MediaBunny StreamTarget with
1 MiB chunks, not BufferTarget. Success closed and reopened the file, read its
tracks/duration, and decoded a first sample. Success, exceptions and cancellation
removed temporary entries. No synchronous OPFS handles or Workers were needed.
This was tested in a secure localhost page, not yet the launcher's app iframe.

| Experiment | Short input | Longer input | Additional memory |
| --- | --- | --- | --- |
| MediaBunny Conversion, 1080p AVC to width-1080 VP9 | 2s | 12s | 297 → 670 MiB |
| Manual sink/encoder, same output | 2s | 12s | 285 → 732 MiB |
| Explicit CPU canvas readback | 12s | 60s | 794 → 769 MiB |
| Eight in-flight packets/frames, VP9 | 12s | 60s | 664 → 707 MiB |
| Eight in-flight packets/frames, AVC | 12s | 60s | 609 → 654 MiB |
| Main-thread lamejs MP3, 128kbps, reused PCM buffers | 60s | 180s | 231 → 233 MiB |

The longer cases indicate a plateau for the tested resolutions/codecs, NOT a
small universal memory bound. Explicit CPU readback did not improve the result.
Video output grew to 19–31MB while target writes remained <=1MiB. Native encoder
and canvas allocations still matter; an eight-frame application queue alone did
not eliminate them. Do not enable compression based only on streaming output.

Native AVC/AV1/VP9 encoding was available here; HEVC, MP3 and AAC encoding were not.
A short AV1 transcode also succeeded. A main-thread lamejs encoder successfully
converted WAV, MP3, AAC/M4A and FLAC inputs to MP3. That is a feasibility result,
not a package choice or production license/quality review. Native decoding plus
small reusable PCM buffers avoids decoding all audio into an AudioBuffer.

Video cancellation completed in about 82–209ms in the tested cases and left no
OPFS entry. MP3 cancellation similarly removed its output. Manual VP9 muxing
reported a duration one frame short (59.917 vs 60s); that prototype needs timestamp
correction. MP3 padding/gapless behavior and full A/V synchronization remain open.
Video fixtures did not include audio, so no claim of audio preservation follows.

## Proposed implementation plan

1. **Define a media preparation contract, separate from IRFS and UI.** A disposable
   session owns the source File, bounded reader, metadata, preview artifact and
   eventual upload artifact. Provide AbortSignal, progress, explicit close and
   stale-result isolation. Serialize expensive decode jobs; do not retain decoded
   originals in reactive state. For confirmed local nfile media, reuse bounded range/stream reads rather than
   converting the entire response into an in-memory Blob; this does not extend
   to website previews or bypass the existing local-only routing. Keep byte identity explicit: `uploadFile` is the
   original today and a finalized transformed File only when compression is added.

2. **Separate preview and transformation capabilities.** Preview consumes bounded
   decoded rows/tiles or one frame and emits a <=320px Blob plus source display
   dimensions and <=100px ThumbHash. Full-quality transformation asks its backend
   for the target resolution directly. Share reading, probing, orientation,
   color handling, resampling, cancellation and disposal; do not upsample a 320px
   preview or a DC-only JPEG to create the compressed file. Preserve PNG alpha
   with premultiplied reduction. Make color correction order and 16-bit rounding
   explicit and test them on real photographs as well as synthetic patterns.

3. **Promote format-specific backends only after coverage gates.** The PNG row path
   is the strongest candidate: harden chunk ordering/critical chunks, malformed
   input, metadata bounds, APNG poster/first-frame semantics and all filters.
   Native scaled baseline JPEG is viable for tested variants, using supported
   scales and orientation-aware dimensions. Progressive JPEG needs a specialized
   backend that covers separate scans, restarts, grayscale/CMYK and profiles;
   neither the incomplete DC prototype nor full native decode meets the complete
   contract today. GIF needs streamed LZW/first-frame composition; WebP/AVIF need
   backend-specific reduced/tiled decoding or externally backed intermediate
   storage. These are unresolved development gates, not established solutions.
   Do not substitute resolution cutoffs/cards or an unbounded native fallback
   and call the memory requirement solved. Keep unsupported routes unpromoted
   until their existing preview functionality can be preserved.

4. **Use MediaBunny for file probing/demuxing and native WebCodecs for bounded video
   preview work.** Decode the first verified usable key frame, account for rotation,
   sample aspect ratio and declared color metadata, reduce immediately, and close
   every frame/input. Decode alpha separately and combine on the main thread;
   do not enter its Worker-based merger. Validate nonuniform alpha and HDR before
   claiming support. Platforms lacking a codec retain their explicit unsupported
   status; tests here do not establish HEVC support.

5. **Reuse the resulting thumbnail throughout attachment preparation UI.** Composer
   and pending/error bubbles use the owned small preview, not the original object
   URL. Keep upload bytes separate from the displayed source. Inspect gallery,
   replies and confirmed thumbnail consumers to prevent an immediate second decode
   of the original; extend their thumbnail contract only within this feature.
   Preserve attachment naming, dimensions, ThumbHash, captions, reply state,
   animation/scroll ownership and download URLs. Fullscreen/playback remains a
   distinct user-triggered future operation.

6. **Reserve a future transform stage without enabling compression.** The flow is
   source → inspect → optional transform → finalized upload File → metadata,
   preview/ThumbHash and IRFS preparation. With compression off, the transform
   is an identity operation and uploads remain byte-for-byte unchanged. For a
   future transformed file, calculate filename/MIME/size/dimensions, MMR root,
   nfile and metadata from THAT file. Retry retains the finalized artifact and
   prepared chunks; it does not recompress or create new IDs/timestamps.

7. **Use temporary storage with backpressure for future encoded output.** Prefer
   async OPFS in the actual app origin after capability validation; provide a
   chunked IndexedDB adapter if that environment requires it, never an implicit
   file-sized memory target. Writers support seeks for containers that need them.
   Finalization closes writers before exposing the File. Cancellation, replacement,
   send success and owner unmount release files/URLs; abandoned session artifacts
   need scoped startup cleanup that does not delete another active tab's data.
   Avoid concurrent full decode, encode and hashing working sets.

8. **Do not inherit compressor policies accidentally.** Represent the inspected
   medium settings as future configuration data. Decide resize semantics explicitly
   (dimensions after rotation, no unwanted upscaling), alpha/animation/HDR behavior,
   metadata retention and codec availability. Do not silently drop audio or change
   MP3 to another format when native encoding is absent. A no-Worker MP3 backend
   is feasible but requires its own reviewed adapter. Encoding should own bounded
   queues and close resources, with measured resolution-dependent budgets; current
   video peaks are too high to market as lightweight.

9. **Validate before integrating and again in the real launcher.** Commit focused
   regression fixtures and tests for the supported format matrix, corruption,
   repeated selection/cancellation, resource release and UI preview reuse. Measure
   whole-browser memory across increasing source area and duration, not just JS
   heap or final output size. Check cross-tab cleanup, secure app-origin temporary
   storage, offline behavior, low-memory devices, mobile and other engines.
   Review the current 15s local-preview timeout: a slow decoder should have
   progress/cancellation and a stalled-work policy, rather than reverting to a
   large native decode just because it is faster. Compression stays off; later
   activation additionally requires quality, A/V sync, metadata and actual output
   byte validation, including failure/retry. Run app tests/lint/build only when
   production changes are introduced.

This investigation provides a workable contract and several measured backends,
not complete format coverage. No mobile/other-engine tests or real app-iframe
compression tests were performed. Those limits must remain visible during review.

## Sources

The actual nostr-compress checkout is commit
`c9e74236c34aa1efe94668ce0c45cc5ca5fbbe6a`:
[App.tsx](https://github.com/iefanx/nostr-compress/blob/c9e74236c34aa1efe94668ce0c45cc5ca5fbbe6a/src/App.tsx),
[ImageCompressor.ts](https://github.com/iefanx/nostr-compress/blob/c9e74236c34aa1efe94668ce0c45cc5ca5fbbe6a/src/ImageCompressor.ts),
[AudioCompressor.ts](https://github.com/iefanx/nostr-compress/blob/c9e74236c34aa1efe94668ce0c45cc5ca5fbbe6a/src/AudioCompressor.ts),
[VideoCompressor.ts](https://github.com/iefanx/nostr-compress/blob/c9e74236c34aa1efe94668ce0c45cc5ca5fbbe6a/src/VideoCompressor.ts).

- [MediaBunny streaming output](https://mediabunny.dev/guide/writing-media-files)
- [MediaBunny MP3 extension](https://mediabunny.dev/guide/extensions/mp3-encoder)
- [lamejs incremental encoding](https://github.com/zhuker/lamejs)
- [PNG specification](https://www.w3.org/TR/png-3/)
