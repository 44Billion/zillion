# Local media preparation and validation

## Implemented flow

Selection now creates an explicitly disposable upload artifact. Its File is
currently the exact original; compression is **off**. Preview preparation completes
before IRFS hashing starts, avoiding overlap between the decoder and hashing
working sets. Neither the preview nor its ThumbHash ever supplies upload bytes.

`src/services/media-preparation/` owns the reader, serialized work queue and
format backends. Picked files are sliced; stored nfiles use validated HEAD/range
responses, preserving `localOnly=1`. The main thread does not collect the entire
local response. Image work runs in one disposable Worker, bundled into the app
by esbuild's `?worker` plugin. No remote scripts or launcher API changes are used.
Cancellation terminates the image Worker and disposes MediaBunny inputs/canvases.
Local preview work has a 120-second watchdog; existing HTTP previews retain their
separate 15-second deadline. Failure leaves the original file sendable.

- PNG: validate chunks/CRCs and inflate incrementally, retaining two scanlines
  and accumulators for an at-most-320px result. Handles all legal color types,
  depths and Adam7. The 16 MiB scanline, 1 MiB metadata-chunk and 4 MiB expanded
  profile guards reject pathological allocations. These are decoder safeguards,
  not upload-size quotas. APNG uses its default image, not animated playback.
- JPEG: inspect SOF/EXIF, then request a supported native 1/2, 1/4 or 1/8 decode
  size. Keep source dimensions and orientation separate from thumbnail size.
- Other images: native ImageDecoder or createImageBitmap in the disposable Worker.
  These compatibility paths **still have format-dependent memory costs**.
- Video: MediaBunny 1.56.3, bounded CustomSource cache/reads, the first verified
  key packet, and one small CanvasSink. Rotation, sample aspect ratio and alpha
  are preserved in the tested variants. Browsers without a WebCodecs decoder
  can use native video as a compatibility path, with native frame costs.

The resulting Blob is at most 320px; ThumbHash uses at most 100px. An 8 MiB,
128-entry in-memory FIFO shares these compressed previews across composer,
outbox/confirmed bubbles, gallery and replies. Concurrent consumers share one
preparation, but own separate object URLs. Abort/removal/route cleanup releases
URLs; the last departing waiter cancels unfinished work. This cache is separate
from the 64 MiB HTTP image cache and 16 MiB avatar cache and is not persistent.
Local video players use the small poster with `preload=none`; the original is
loaded for playback. Native downloads still use the launcher stream, never a
file-sized Blob.

## Compression follow-up boundary

`artifact.js` is the identity stage today. A future transform must finalize a new
File before deriving MIME, filename, size, dimensions, ThumbHash, MMR root and
nfile. Retry must retain that finalized artifact. Its implementation will need
bounded seekable output storage and cleanup, codec/format capability checks,
explicit resize/alpha/animation/HDR policies and separate memory measurements.
There is no compression toggle, encoder, transformed output or temporary encoded
file store in this change.

The PNG preview reducer averages encoded colors with premultiplied alpha before
native color conversion of the small result. It is suitable for thumbnails, not
a full-quality color-managed compression resampler. Do not upscale these previews
or use the incomplete experimental JPEG DC decoder for compression. The former
no-Worker constraint has been relaxed: MediaBunny Workers are permitted and
verified below. SharedArrayBuffer/cross-origin isolation is a separate capability
and was not enabled by this change.

## Automated validation

All browser processes run sequentially through the launcher's existing systemd
3 GiB guard with swap disabled. Temporary profiles and generated large fixtures
are removed by the harness. Measurements include native browser memory and file
cache, not only the JavaScript heap, and do not use forced GC.

- Node tests cover every legal PNG color/depth combination, Adam7/noninterlaced
  pixel equality, malformed CRC/truncation, JPEG orientation/scales, serialized
  cancellation, original File identity, bounded range validation and independent
  thumbnail URL disposal.
- `tests/browser/media-preparation.browser.js` runs the production bundle against
  small PNG/JPEG/GIF/WebP/AVIF variants and AVC/AV1/VP9 video, including rotation,
  non-square pixels, alpha, corrupt input and a disabled-WebCodecs fallback.
  Every pixel of the small PNG color/depth fixtures is also compared against
  Chrome's independent native decoder (at most two premultiplied 8-bit levels
  of rounding difference). Workers are counted and must be terminated after
  each operation. A large-image
  cancellation must settle within one second.
- Two generated PNGs measured **34 MiB additional at 8192×8192 (67 MP)** and
  **31 MiB at 16384×16384 (268 MP)**. The complete isolated suite peaked at
  **404 MiB**, with no swap. Results are host-specific, not browser guarantees.
- The real launcher attachment suite exercises MediaBunny alpha Workers, preview
  URL revocation, pending-to-confirmed video playback, gallery/replies, locked
  vault retry, native exact-byte downloads, offline reload and service-worker
  restart. The fixture's PNG CRC is valid so strict and native decoders consume
  the same bytes.
- The full self-chat regression passed, including initial bottom pinning, reading
  anchors, overlapping growth, reduced motion and retained-route restoration.
  Its complete launcher/test process tree peaked at **2330 MiB**, with no swap.
- **66 Node tests, lint and the production build passed.** The browser matrix uses
  the production bundler; the full self-chat suite uses the development build in
  the real launcher. No production publication was performed.

Run the isolated matrix with:

```sh
node ../../44billion/bin/run-browser-tests.js -- node --test tests/browser/media-preparation.browser.js
```

Use `npm run test:browser:attachments` for the focused launcher suite; use the
same guard with `tests/browser/self-chat.browser.js` for the full scroll/reply
regression. Stop the local dev watcher before starting browser suites.

## Remaining limits

The native progressive JPEG, WebP, AVIF and GIF paths are **not a solved universal
memory bound**. Serialized preparation and Worker termination prevent overlapping
or retained decoder work; they do not eliminate a single decoder's high peak.
The preceding research measured roughly 197 MiB for a 67 MP progressive JPEG and
roughly 600 MiB for some other native formats. Specialized backends remain a
follow-up; there is no resolution cutoff replacing otherwise supported previews.
Long video playback is browser-managed and outside the one-frame preview budget.

This validation uses local desktop Chrome. Mobile devices, Firefox/Safari, HEVC,
real-camera HDR/wide-gamut accuracy and future compression are not established by
these tests. Synthetic color/alpha fixtures are not a photographic fidelity study.
The original memory research remains in `media-memory-experiments.md` and
`media-memory-variants-and-plan.md`; their no-Worker statements describe the
constraint at the time of those experiments, not the current implementation.
