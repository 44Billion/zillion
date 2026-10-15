# Zillion logo

`selected-concept.png` is the approved image-generation concept. Its checkerboard
is baked into the pixels; never ship that background. `logo.png` is the transparent
cutout of the same chosen design, produced with the built-in image generation tool.
Both files preserve the original outputs for future artwork work.

The positioning prompt requested a very small leftward correction of the Z while
preserving the chat bubble. The final extraction prompt removed the checkerboard
while preserving the green bubble, Z, proportions, colors, highlights, and tail.

`../../src/assets/media/branding/zillion.icon.png` is an optimized 256 × 256
RGBA PNG derived directly from `logo.png`, preserving its transparency and artwork.
It includes the framing previously supplied by the SVG wrapper: the original
source rectangle `(0, 0, 1254, 1254)` is drawn at
`(91.5 × s, 87 × s, 1254 × s, 1254 × s)` on a transparent 256px square, where
`s = 256 / 1455`. This is the same transform as the old viewBox
`-91.5 -87 1455 1455`, keeping placement and padding independent of file format.
Use high-quality Canvas smoothing when downsampling, then losslessly recompress
the PNG IDAT data with DEFLATE level 9. The shared asset is about 44 KB, without
an SVG wrapper or Base64 encoding; the 1254 × 1254 original stays unchanged here.

The visible alpha >= 16 bounds are `(54, 106)` to `(1218, 1175)` on the original
and `(25, 33)` to `(230, 222)` on the shipped PNG. The bubble occupies about 80%
of the icon width, including its tail, with about 10% safety padding on each side.
Keep these proportions in sync if replacing the artwork.

Use this single artwork in both color schemes, without filters or tinting.
The header displays the padded image at 125% of its logo box, so the actual bubble
shrinks from 42px to 28px. The HTML icon declaration lets nappup select the same
self-contained asset for the launcher. The build copies it without putting the
raster bytes into JavaScript; design sources are not published.
