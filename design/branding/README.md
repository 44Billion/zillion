# Zillion logo

`selected-concept.png` is the approved image-generation concept. Its checkerboard
is baked into the pixels; never ship that background. `logo.png` is the transparent
cutout of the same chosen design, produced with the built-in image generation tool.
Both files preserve the original outputs for future artwork work.

The positioning prompt requested a very small leftward correction of the Z while
preserving the chat bubble. The final extraction prompt removed the checkerboard
while preserving the green bubble, Z, proportions, colors, highlights, and tail.

`../../src/assets/media/branding/zillion.icon.svg` embeds the transparent PNG unchanged.
This SVG is a sizing wrapper, not a vector tracing. Its square viewBox centers the
visible artwork with 10% safety padding on each side: the visible alpha >= 16
bounds are `(54, 106)` to `(1218, 1175)` on the 1254px source, and the viewBox is
`-91.5 -87 1455 1455`. The bubble occupies 80% of the icon width, including its tail.
Keep these proportions in sync if replacing the artwork.

Use this single artwork in both color schemes, without filters or tinting.
The header displays the padded image at 125% of its logo box, so the actual bubble
shrinks from 42px to 28px. The HTML icon declaration lets nappup select the same
self-contained asset for the launcher. The build copies it without putting the
raster bytes into JavaScript; design sources are not published.
