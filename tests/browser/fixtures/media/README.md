# Synthetic media regression fixtures

Generated locally for preview testing, not copied from third-party media. Image
patterns use Pillow 12.3.0 and a PNG chunk generator; JPEG separate-scan input
uses mozjpeg cjpeg 3.3.1. Short video patterns use FFmpeg 7.0.2. The rotated MP4
contains a 90-degree tkhd matrix; SAR is 2:1; the VP9 alpha fixture is red with
63/255 opacity. FFmpeg is a fixture tool, never an application dependency.

PNG fixtures cover all legal color/depth combinations with and without Adam7,
palette/tRNS, AdobeRGB ICC and malformed CRC/truncation. JPEG fixtures cover
subsampling, progressive/baseline, restart markers, EXIF orientations, CMYK and
ICC, separate DC scans and truncation. Profiles come from the host's colord ICC
profiles used in the original investigation. Animated fixtures test first/default
frame preview and animation metadata. The `animated-playback` GIF/WebP/APNG
fixtures are two solid 96x64 frames (green/magenta), 300ms each, looping forever;
browser tests compare actual rendered pixels across bubble/viewer navigation
and offline reload. See docs/media-memory-variants-and-plan.md
and the locally preserved tmp/media-memory-variants generators for provenance.


Compression fixtures added in September 2026 are synthetic. `compression.mp4`
uses FFmpeg 7.0.2 testsrc2 at 1600x900/24fps for 2s, H.264 ultrafast/crf5 and a
440Hz AAC track. `compression.wav` is stereo 48kHz PCM. `compression-hdr.webm`
uses 640x360/12fps, 10-bit VP9 with BT.2020/PQ tags (not a reference HDR master).
`compression-rotated.jpg` uses Pillow, deterministic random RGB 1600x900,
quality 95, EXIF orientation 6 and a synthetic Artist field. GIF/APNG fixtures
have 12 frames 400x300, transparent pixels, differing disposal/blend modes,
50/100ms durations and finite loops. The APNG includes disposable textual
metadata to exercise successful recompression and metadata removal. Long audio,
video and animation variants are generated at test time in temporary storage;
no long original or ffmpeg executable enters the application bundle.
