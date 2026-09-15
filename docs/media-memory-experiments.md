# Attachment preparation: memory experiments

Research on 2026-09-15, Chrome 153.0.8010.36 on Linux. No production service,
component, dependency, launcher API or published build was changed.

The user requested memory efficiency before speed, no separate Worker, and
retaining previews instead of imposing a resolution cutoff. The experiments
found practical strategies for the tested formats, not a universal ready-made
decoder. The local reproducible laboratory is in
[`tmp/media-memory-lab`](../tmp/media-memory-lab/README.md), deliberately outside
the app bundle and ignored by Git. It contains sources, pinned dependency lock,
fixture generators, raw measurements and a visual comparison. Preserve that local
directory separately if moving checkouts; it is not a committed test suite.


The [follow-up variant matrix and implementation plan](media-memory-variants-and-plan.md)
adds broader format coverage and future compression experiments. Its results
supersede the remaining-variant checklist below, not the original measurements.

## Method and safety

Every browser and fixture-generation command ran through the launcher's existing
`run-browser-tests.js`: a Linux cgroup capped at 3 GiB with zero swap, a 15-minute
maximum and cleanup of all descendants. Only one group ran at a time. The owned
local development runtime was paused and restored afterward. There were no OOM
kills or swap allocations.

Node sampled cgroup `memory.current` every 10 ms, outside the busy page thread.
Each comparison used a fresh Chrome; repetition tests intentionally reused one
Chrome without forced GC. Tables show additional memory above the pre-operation
baseline, including browser native/shared/file-backed allocations, not only V8
heap. Sampling may miss very short peaks; filesystem caches, allocator behavior,
GPU and decoder implementations affect the result. The launcher/vault and MMR
hashing were excluded to isolate preview preparation.

An audit confirmed the exact unit cgroup, `memory.max=3221225472` and a direct
kernel `memory.peak` reading. The systemd exit summary under-reported peaks in
some very short runs; the comparative measurements use the direct cgroup
samples, not that summary.

The first anonymous/shared-memory-only experiment was rejected because it missed
file-backed native image allocations. Use `results-total.jsonl`, not the early
`results.jsonl`, for comparisons. Outputs were 320px thumbnails; ThumbHash would
subsequently use a <=100px reduction of that thumbnail.

## Order and findings

1. Native ImageDecoder with desired dimensions: JPEG baseline improved strongly,
   but requesting below its available 1/8 JPEG scale failed in this Chrome.
   Respecting that scale worked. PNG ignored the requested dimensions; progressive
   JPEG still retained a large coefficient working set.
2. createImageBitmap with resize options: the result was small, but intermediate
   allocation still grew with original image area. Rejected as a memory bound.
3. MediaBunny 1.56.3 CanvasSink with lazy BlobSource and a 1 MiB source cache:
   duration stayed cheap, while frame resolution still controlled decode cost.
4. MediaBunny demuxing plus one verified key packet into native VideoDecoder,
   with latency optimization: smaller than CanvasSink, explicit close/dispose,
   and no additional frames/track decoding needed for the tested files.
5. Specialized PNG row processing: the first prototype used DecompressionStream
   but queued inflated output while the row consumer yielded. Replacing it with
   controlled pako 2.1.0 pushes and processing each output before feeding more
   input removed that growth. png-tools 1.1.1 supplies header interpretation;
   row filtering/reduction in this lab is custom prototype code.
6. Specialized JPEG DC thumbnail extraction: baseline AC coefficients are skipped;
   progressive JPEG stops after its first interleaved DC scan. Small thumbnail
   accumulators replace full-resolution pixels/coefficient arrays. This produces
   an approximate, less detailed preview. It is custom exploratory code, not an
   existing production library or a full JPEG decode.

wasm-vips was ruled out by its documented Worker/SharedArrayBuffer requirements,
without running it. jSquash's public JPEG decode API returns complete ImageData;
that API does not supply the required incremental thumbnail path. These were
source/API inspections, not performance measurements.

## Images: measured extra memory

The comparison uses 2048², 4096² and 8192² synthetic images (4.2, 16.8 and 67.1 MP).
Values are approximate MiB, rounded from samples.

| Path | 4.2 MP | 16.8 MP | 67.1 MP |
| --- | ---: | ---: | ---: |
| Native Image + decode + canvas, PNG | 40 | 156 | 618 |
| Native Image + decode + canvas, baseline JPEG | 21 | 69 | 619 |
| ImageDecoder, PNG | 39 | 155 | 612 |
| ImageDecoder, baseline JPEG at supported reduced scale | 1 | 2 | 9 |
| ImageDecoder, progressive JPEG at reduced scale | 12 | 50 | 197 |
| createImageBitmap resize, PNG | 17 | 65 | 258 |
| createImageBitmap resize, baseline JPEG | 14 | 65 | 258 |
| PNG rows + controlled pako | 18 | 32 | 34 |
| JPEG DC prototype, progressive | 11 | 8 | 9 |
| JPEG DC prototype, baseline | 10 | 10 | 10 |

A 16384² PNG (268.4 MP) also retained its preview: about 40 MiB additional memory
and 8.1 seconds in the isolated first run. The fixture was generated line by line
rather than creating an enormous source canvas or ArrayBuffer. The row technique
scales with row width plus fixed thumbnail buffers, not full image area; it is
not mathematically constant for unbounded widths.

PNG prototype calls subsequently reused scratch buffers. Five consecutive 268 MP
previews with small thumbnail presentation had total group peaks of 345–360 MiB
and took about 8.5 seconds each. The final group peak was 360 MiB, with zero swap.
Canceling a subsequent preview took 132 ms.

Thirty consecutive 67 MP progressive JPEG previews, after adding scratch-buffer
reuse, had total group peaks of 230–254 MiB. Cancellation took 60 ms. Before
buffer reuse, the short-lived typed arrays produced a larger GC sawtooth; that
was addressed rather than interpreting small live working state as a complete
memory measurement.

## Video: measured extra memory

| Fixture | Native video | CanvasSink | One key packet |
| --- | ---: | ---: | ---: |
| VP8/WebM, 1080p, 1 second | 38 MiB | 30 MiB | 13 MiB |
| VP8/WebM, 1080p, 10 seconds | 41 MiB | 30 MiB | 13 MiB |
| VP8/WebM, 4K, 1 second | 159 MiB | 126 MiB | 55 MiB |

A separate valid 64 MiB EBML Void preceding the same 1080p Segment exercised
random access: four reads totaling 595,853 bytes, approximately 17 MiB extra
memory. This demonstrates seeking/cache behavior, not a noisy 64 MiB video
payload benchmark. Decoded frame resolution still matters; the result is not a
fixed memory cap for arbitrary codecs/resolutions.

## Preview quality and reuse

Gradient/edge and alpha fixtures were compared with native small thumbnails.
Mean absolute channel differences (0–255 scale) were 0.45 for PNG, 0.88 for alpha
PNG and 1.56 for progressive JPEG DC. The JPEG preview visibly softens fine edges.
These are synthetic examples, not a broad perceptual-quality or ICC conformance
corpus. Large local differences can occur at edges and transparent pixels.

Verification encodes the small result and presents that thumbnail in an Image;
it does not reopen the original for the preview. This validates the intended
composer approach. The current app still reopens the original in attachment.js;
none of these prototypes is integrated there yet. All full files remain intact.

## Boundaries before integration

- PNG prototype: only non-interlaced 8-bit RGB/RGBA. CRC, indexed/grayscale/16-bit,
  Adam7, APNG, color profiles and malformed-data validation need implementation
  and conformance tests. Current success must not become silent card fallback for
  other variants: the user explicitly preferred preserving their previews.
- JPEG prototype: only the tested 8-bit interleaved YCbCr arrangements, no restart
  markers, CMYK, non-interleaved initial DC scans, EXIF orientation or complete
  color management. DC-only output intentionally omits fine detail and later
  progressive refinements. Reading an early scan does not verify file integrity.
- Video prototype: VP8/WebM only tested. H.264/HEVC/AV1, rotation, non-square pixels,
  alpha, corrupt/unsupported streams and devices with different decoders remain
  to be tested. Frame memory is still proportional to frame dimensions.
- No browser-level universal peak-memory guarantee was established. Browser
  process memory includes allocator/cache behavior beyond application control.
- Small scratch arrays are shared by serial prototype calls. Production code
  needs explicit ownership, cancellation, stale-result isolation and disposal.
- The application uses a 15-second preview deadline. Long but memory-efficient
  decodes need a reviewed deadline policy; speed was deliberately deprioritized.
- The app's composer, pending bubbles, gallery, replies and confirmed-message
  rendering need a consistent thumbnail contract. Optimizing generation alone
  must not trigger another original decode in the composer.
- No tests on physical mobile devices or other browser engines. No production
  code, library package version or deployment changed in this investigation.

## References

- [MediaBunny input sources and disposal](https://mediabunny.dev/guide/reading-media-files)
- [MediaBunny sinks](https://mediabunny.dev/guide/media-sinks)
- [ImageDecoder desired dimensions](https://www.w3.org/TR/webcodecs/#imagedecoderinit)
- [wasm-vips requirements](https://github.com/kleisauke/wasm-vips/blob/master/README.md)
- [png-tools public API](https://github.com/mattdesl/png-tools)
- [PNG filtering specification](https://www.w3.org/TR/png-3/#9Filters)
