# Zillion

A private chat inspired by WhatsApp and Signal, built as a Nostr client.
Messaging will use [`libp2r2p/private-messenger`](../libp2r2p/private-messenger/index.js),
which combines private messages (`private-message`) with transport over private
channels (`private-channel`). The entire front-end uses **thenameisf**.

The project is just getting started: this repository contains documentation,
tooling, a home preview with fixed sample DMs, and reusable avatar/cache foundations.
Real conversations, identity, and messaging integration have yet to be implemented.

Zillion will run as a SPA inside the **44billion launcher**, using its
[committed injected API contract](https://github.com/44Billion/44billion/blob/main/APP_API.md).
Startup will identify the instance's fixed user through `window.nostr.peekPublicKey()`.
Personas will expand known-contact discovery, while the inbox remains limited to
that user. Routing will use the browser History API through thenameisf's
`useLocation` and `f-route`, and reactive i18n will follow the
launcher's locale. Widget integration is out of scope.

Zillion is **offline-first**: the launcher loads the installed app, Nostr events
and private-message personal copies belong in `window.napp.eventStore`, and
image bytes use `libp2r2p/idb-queue` (IndexedDB). `temporaryStorage` is reserved
for disposable session data. Cached content renders before remote refreshes;
uncached avatars use a generated fallback. HTTPS images need a successful
CORS download to be reliably available offline. Message attachment rendering
and conversation persistence are still planned.

## Home preview

The home follows one mobile layout, capped at 718px and centered on wider screens.
It includes a temporary Z logo, top-right profile portrait, a horizontal contact
strip (pinned first, then alphabetical), and a DM list sharing its unread counters
with contact avatars. Touch scrolling snaps to
whole contacts; mousewheel and arrow keys move by contact. Only More stays fixed
in the strip. The header and the strip divider remain visible during vertical
scrolling. Once the divider reaches the header, further scrolling gradually
compacts the header and logo to 48px including the divider (plus any device
safe-area inset). The placeholder ends at 28x28px as the Zillion wordmark fades
out; both reverse when scrolling back. Contact avatars mount as they approach
the visible strip.
Light and dark themes follow the system; backgrounds are off-white and graphite.
Preview content is fixed English JSON with local portraits, and the buttons
remain intentionally inert.

## Development

Requirements: Node.js 24+, npm, Python 3, and the sibling `44billion` and
`ez-vault` repositories with their npm dependencies installed. Chrome is also
required for browser tests (`CHROME_BIN` overrides `/usr/bin/google-chrome`).

```sh
npm install
npm start                 # local launcher + watch + automatic draft publishing
npm run start:adb         # same workflow on Android, with forwarded ports and console logs
npm test                  # fast Node tests; no publishing
npm run test:browser      # real launcher/vault in disposable Chrome profiles
npm run lint
npm run build             # production files in dist/zillion/
npm run upload:draft      # one-shot development build and draft upload
npm run serve             # standalone production preview; stop the dev vault first
```

`npm start` uses `http://localhost:10000`, esbuild on port 8080, and the existing
vault origin at `http://localhost:4000`. It reuses a compatible running launcher;
Ctrl+C stops only processes it started. Conflicting servers fail explicitly.
Install and open the printed draft URL once to follow subsequent updates.

For Android, install Android platform-tools, enable debugging, authorize the
computer, and check `adb devices`. Run `npm run start:adb`, then open the printed
draft URL in Chrome/Edge on the phone. The script forwards ports 10000 and 4000
with `adb reverse`; esbuild's port 8080 stays internal. The phone uses its own
browser storage and vault accounts. Draft updates still clear app data.
Use `-- --debug` for verbose console logs or `-- --browser=edge` to prefer Edge.
Set `ANDROID_SERIAL` to select a device; an already paired/connected wireless ADB
device works too. The console uses an automatically assigned host port unless
`CDP_PORT` is set. Ctrl+C releases only mappings created by that session.

Successful builds publish after two seconds without changes. Uploads run one at a
time from isolated build files; the latest pending build replaces older pending
work. Build errors cancel pending uploads. Upload errors leave the last published
version available; save again or run `upload:draft` to retry. Builds and uploads
use the installed, lockfile-managed tools. Changes to build scripts or dependency
configuration require restarting `npm start`.
If an uploader is forcibly killed, a stale `tmp/upload.lock` is reported rather
than reclaimed while another process may be acquiring it. Remove that lock after
confirming its uploader has stopped, then retry.

Browser tests install an unpublished build into the real launcher's caches using
its own storage helpers. They use the actual injected APIs, vault and permission
UI, with external traffic blocked and controlled network fixtures. No public
upload, API stubs, in-source runner, or existing browser profile is required.
Persistence scenarios reload the same app document/version and recover data from
the event store and IndexedDB. Temporary kind 30078 test state expires after 24
hours; profiles are removed after each scenario. Failure diagnostics and screenshots
are saved under `tmp/browser-failures/`.

A **draft version update clears app data before reloading**. An ordinary document
reload does not. The workflow preserves that launcher behavior. Browser fixtures
are excluded from published builds. The home preview's fixed JSON and bundled
portraits are intentionally included for visual review; no controls perform
actions and no real identity, contacts, or messages are read. `serve` provides no injected launcher APIs.

## Publishing

Zillion will be a static site published as an **nsite** (also called an app,
napp, or Nostr app), following [NIP-5A — Named Sites](https://github.com/nostr-protocol/nips/blob/master/5A.md#named-sites).
The project's runtime environment **does not support service workers**.

`npm run upload` compiles and publishes to **main** using the installed nappup.
`npm start` and `npm run upload:draft` publish only to **draft**, with identifier
`zillion`. All three publish to the real network, even with a local launcher.
Publisher identity and upload options follow [nappup](../nappup/README.md).

The build converts [`napp.jsonc`](napp.jsonc) to `.well-known/napp.json`, which
nappup consumes as metadata and excludes from published files. This format is
an ecosystem convention; document customizations separately from NIP-5A.

See [`AGENTS.md`](AGENTS.md) for architecture and contribution guidelines.
Keep both documents updated alongside the changes they describe. Write all
project documentation and code comments in English.
