# Landing media

`conversation-light.webp` and `conversation-dark.webp` show the actual Zillion
conversation with the fictional Maya Chen from the bundled demo fixtures.
Captured on 2026-09-27 with the production app build's `demo: true` option
(equivalent to `ZILLION_DEMO=1 npm run build`), future previews disabled, through
the real local 44billion launcher in a disposable Chrome profile. External
network access was blocked. No real account or conversation was used.

The viewport was 390 × 680 CSS pixels at device scale 2. The screenshot clips
to the app iframe (390 × 630), producing 780 × 1260 WebP files at quality 88.
The conversation is scrolled to its beginning; only scrollbar chrome is hidden
for the capture. Light/dark media emulation selects the actual app themes.
No interface or conversation text is composited into the image.

The landing's other illustrations are original inline SVG components. Its logo
is the unchanged shared `src/assets/media/branding/zillion.icon.svg`, copied
by the landing build rather than duplicated here.

## 44billion platform icon

`44b.png` is an unchanged copy of the approved 360 × 360 transparent cap icon
from `44billion/src/assets/media/44b.png`, copied on 2026-09-27. Keep the original
colors and proportions. It appears in the launch badge on a muted purple
background (dark plum in the light theme, pale lavender in the dark theme).
The local copy keeps GitHub Pages builds independent of the sibling checkout;
esbuild publishes it as a hashed PNG asset.
