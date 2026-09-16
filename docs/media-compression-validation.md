# Automatic attachment compression — validation

Validated on Linux with local Google Chrome, September 2026. No production
publication and no launcher/libp2r2p API changes.

## Contract

New picked media is compressed by default before preview and IRFS. The internal
`compress: false` option preserves the original File. History reuse and retry
never repeat compression. Caption/reply and native download behavior are unchanged.

The shorter oriented side chooses 1080, 720 or 480 pixels; smaller inputs are
not enlarged, both axes share the same scale, and video rounds down to even
codec dimensions. Output uses JPEG .7 for opaque stills, WebP .7 for alpha
stills/animations, MP3 128 kbps for mono/stereo, or MP4 H.264 medium quality with
AAC 128 kbps and two-second keyframes. Video cadence is unchanged; alpha/HDR
uses MediaBunny defaults. Animations preserve composed frames, alpha, duration
and loop count. Multichannel audio and incompatible/discarded tracks retain the
original rather than silently changing playback.

Images are encoded from the source at upload resolution, never from the 320px
thumbnail. PNG uses a linear-sRGB, premultiplied-alpha row reducer; uncommon
profiles use native color management within its memory guard or fallback.
Orientation is applied before metadata is stripped. Container metadata is not
copied to transformed media. Fallback originals remain untouched.

Output streams to asynchronous OPFS. Image Worker writes use 64 KiB messages and
acknowledgments; MediaBunny uses a 1 MiB StreamTarget. No BufferTarget, full PCM,
file-sized JS output array or output DataURL is used. Native canvas encoding
necessarily produces one bounded encoded frame Blob at a time. Animated WebP
RIFF/ANMF chunks are written incrementally; the final size/header is patched.

An output at least as large as the input stops the attempt immediately. Reopen
validation checks image dimensions/frame count/loop/duration, and AV track
counts/channels/dimensions/start/end timestamps and decodability. Unsupported,
failed, no-benefit or unavailable-storage attempts return the exact original.
Explicit cancellation always rejects the selection. Unavailable compression
gets a translated informational toast; no-benefit fallback is quiet.

## Ownership and cancellation

`zillion-compression-v1/artifact-<uuid>` files have Web Locks spanning preparation,
composer and outbox. Retry retains the same final bytes/chunks/event. Confirmation,
removal and cancellation explicitly close writers and remove files. Source
replacement cancels stale jobs. Compression and previews share the serial queue.

The first preparation in a document sweeps abandoned artifacts and Chrome's
`.crswap` siblings only when it acquires their owner lock. Other tabs' live
files are preserved. A crash leaves cleanup for the next preparation. No draft
or outbox persistence is introduced. Storage failures that prevent removal may
also defer removal to a later sweep; no persistent attachment quota was added.

## Verified cases

- All 68 Node tests, ESLint, production build and relevant browser suites passed.
- Unit boundaries immediately below/at/above 480, 720, 1080, portrait/landscape,
  squares/extreme aspect ratios, no upscaling and codec rounding. Linear black/
  white PNG reduction gives 188 rather than encoded-space 128.
- Browser opaque/alpha PNG 1600x900 ->1280x720 JPEG/WebP; alpha remains 96/255.
  EXIF 6 JPEG 1600x900 ->720x1280. GIF and APNG 12-frame outputs preserve loop
  counts and timing. All frames are compared after composition: mean
  premultiplied color error below 6/255, alpha error zero for these fixtures.
- Real MediaBunny H.264/AAC conversion, rotation and sample aspect ratio. A
  tagged 10-bit VP9 PQ/BT.2020 source converted successfully using defaults;
  this checks decode/encode, not HDR fidelity or perceptual tone mapping.
  Transparent VP9 was valid but too small to benefit and retained its original.
- Explicit four-channel audio fallback and EXIF removal passed.
- OPFS denial and write refusal, non-smaller output, image/audio/video cancel,
  cleanup, abandoned owner after reload, live sibling-document ownership.
  The ownership test uses separate same-origin iframe documents (independent
  module instances), not two physical browser tabs.
- Final compressed bytes reconstruct through IRFS with matching size, dimensions,
  MIME and filename. The real launcher runs the bundled MP3 encoder, persists
  chunks/1063, retries after vault unlock without creating another encoder,
  downloads the same bytes through Chrome's native download manager, and reopens
  them offline. Originals are never sent merely because preparation was canceled.

Representative results (synthetic inputs, sizes in bytes):

| Input | Original | Final | Output |
| --- | ---: | ---: | --- |
| Opaque PNG 1600x900 | 2,282,965 | 276,885 | JPEG 1280x720 |
| Alpha PNG 1600x900 | 2,257,203 | 341,172 | WebP 1280x720 |
| GIF 12 frames | 847,243 | 557,872 | animated WebP |
| APNG 12 frames, text metadata | 861,922 | 512,126 | animated WebP |
| Stereo WAV 2s | 384,078 | 32,808 | MP3 |
| AVC/AAC 1600x900, 2s | 5,399,547 | about 334,000 | MP4 1280x720 |

## Memory measurements

All Chrome tests run sequentially through the existing Linux cgroup runner:
3 GiB total for Node, build tools, runtime and Chrome descendants; swap disabled.
The production-code compression matrix runs on a disposable localhost page;
chat integration runs inside the actual launcher/vault with external traffic
blocked. Tests do not promise these peaks on every device/codec implementation.

The duration/selection matrix peaked at 1,092 MiB in one completed run:

| Workload | Observed whole-cgroup peak |
| --- | ---: |
| Stereo WAV 60s /180s | 387 /455MiB |
| Video 12s /60s | 1,080 /1,092MiB |
| PNG 2048² /4096², sequential warm process | 1,021 /991MiB |
| GIF 24 /288 frames | 933 /1,033MiB |
| Three repeated short AV conversions | 1,057 /1,054 /1,066MiB |

These are warm-process totals, not isolated per-codec allocations. The 60s video
fixture repeats video packets only; audio duration is tested separately and
short audiovisual fixtures cover synchronization. A first attempt repeating
trimmed AAC packets accumulated encoder padding; validation correctly refused
that synthetic result. It was replaced by a video-only duration fixture rather
than weakening the duration check. No full decoded animation/PCM output is
retained. Native image decoders can retain encoded input; caps below bound that
working set. Chrome/native allocators do not immediately return all memory to
baseline, but repeated successful/canceled jobs plateaued and OPFS was empty.

The focused launcher attachment suite passed at 2,194 MiB. An initial full self-chat
run hit the 3 GiB limit and was killed safely by the runner. Investigation found
that its development fixture also installed 7.7 MB of unused source maps through
one CDP expression, adding copies during fixture installation. The self-chat
fixture now omits source maps while retaining development UI flags and releases
the installation expression after use. This does not disable source maps for
normal local development. The final combined compression/self-chat run passed at 2,823 MiB (2.76GiB),
without swap, including retained navigation, reading anchors, overlapping growth
and reduced motion. The remaining margin to 3 GiB is modest; keep the limiter.
The gallery/filename tests also now wait for mounted child content rather than
racing the framework's deferred rendering.

## Coverage limits and fallback safeguards

- Native image compression input is capped at 32 MiB, native image surfaces at
  16 Mi pixels, target surfaces at 8 Mi pixels, animation count at 10,000. Baseline
  JPEG uses scaled native decode; large PNG uses row reduction. These are
  compression-backend safeguards; they do not reject upload/download or remove
  the existing preview flow. Encoded input/native caches still have costs.
- The tested AVIF variants fail native ImageDecoder track discovery in this
  Chrome and correctly keep their originals. Unavailable encoders/formats
  follow the same fallback. Passing `isTypeSupported` alone is insufficient.
- Mobile devices, Safari and Firefox were not available for validation. Native
  codec support and memory behavior require their own measurements. Video
  peaks remain substantial even when duration growth is bounded.
- No claim of perceptually identical lossy output, universal HDR conversion,
  all metadata schemas/formats or every animation disposal edge case. The
  fixtures cover explicit alpha, disposal/blend and timing cases.

## Reproduction

```sh
npm test
npm run lint
npm run build
node ../../44billion/bin/run-browser-tests.js -- node --test tests/browser/compression.browser.js
node ../../44billion/bin/run-browser-tests.js -- node --test tests/browser/compression-memory.browser.js
node ../../44billion/bin/run-browser-tests.js -- node --test tests/browser/media-preparation.browser.js
node ../../44billion/bin/run-browser-tests.js -- node --test tests/browser/self-chat.browser.js
```

Run only one browser command at a time, with the local watcher stopped. Raw
compression results are written to `/tmp/zillion-compression-results.json` and
`/tmp/zillion-compression-memory.json`. Restore `npm start` for local installation;
do not use publish/upload scripts.

The final build was registered with the local watcher (`npm start`), without
remote publication; the real launcher installation was exercised by the browser suite. README, AGENTS and all eleven locale catalogs were updated.
