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
frame preview, not animation playback. See docs/media-memory-variants-and-plan.md
and the locally preserved tmp/media-memory-variants generators for provenance.
