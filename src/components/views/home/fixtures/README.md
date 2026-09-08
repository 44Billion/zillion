# Home preview data

`home.json` is a fixed, fictional inbox for visual review. Contacts are pinned
first, alphabetically within each group; conversation timestamps and labels are intentionally fixed.
No identity, contacts, messages, or presence come from the runtime or relays.
Buttons have no actions or navigation; the contact strip supports scrolling. Remove this preview data when wiring
the real inbox; it is deliberately included in the current layout build.

Sample portraits come from [Random User](https://randomuser.me/photos), which
credits the authorized UI Faces collection. The files are bundled as data URLs,
so this preview never downloads portraits at runtime. Names and messages are
fictional and do not identify the people depicted.

| File | Source portrait |
| --- | --- |
| user.jpg | women/44 |
| maya.jpg | women/47 |
| daniel.jpg | men/32 |
| ellie.jpg | women/68 |
| james.jpg | men/46 |
| nina.jpg | women/49 |
| juliette.jpg | women/65 |
| matteo.jpg | men/75 |
| sofia.jpg | women/90 |
| alex.jpg | men/22 |
| sam.jpg | men/54 |

Source URL pattern: `https://randomuser.me/api/portraits/med/<portrait>.jpg`.
