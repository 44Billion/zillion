# Zillion

A private chat inspired by WhatsApp and Signal, built as a Nostr client.
Messaging will use [`libp2r2p/private-messenger`](../../libp2r2p/private-messenger/index.js),
which combines private messages (`private-message`) with transport over private
channels (`private-channel`). The entire front-end uses **thenameisf**.

The project is just getting started: this repository contains documentation,
tooling, localized home and conversation previews with fixed sample DMs, a reactive toast, and
reusable avatar/cache foundations.
Real conversations, identity, and messaging integration have yet to be implemented.

Zillion will run as a SPA inside the **44billion launcher**, using its
[committed injected API contract](https://github.com/44Billion/44billion/blob/main/APP_API.md).
Startup will identify the instance's fixed user through `window.nostr.peekPublicKey()`.
Personas will expand known-contact discovery, while the inbox remains limited to
that user. Routing uses the browser History API through thenameisf's
`useLocation` and `f-route`. Reactive i18n follows the launcher's initial locale
and subsequent changes in all 11 supported languages. Widget integration is out of scope.

Zillion is **offline-first**: the launcher loads the installed app, Nostr events
and private-message personal copies belong in `window.napp.eventStore`, and
image bytes use `libp2r2p/idb-queue` (IndexedDB). `temporaryStorage` is reserved
for disposable session data. Cached content renders before remote refreshes;
uncached avatars use a generated fallback. HTTPS images need a successful
CORS download to be reliably available offline. Message attachment rendering
and conversation persistence are still planned.

## Home preview

The home follows one mobile layout, capped at 718px and centered on wider screens.
It includes the green chat-bubble Z logo, top-right profile portrait, a horizontal contact
strip (pinned first, then alphabetical), and a DM list sharing its unread counters
with contact avatars. Touch scrolling snaps to
whole contacts; mousewheel and arrow keys move by contact. Only More stays fixed
in the strip. The header and the strip divider remain visible during vertical
scrolling. Once the divider reaches the header, further scrolling gradually
compacts the header and logo to 48px including the divider (plus any device
safe-area inset). The bubble ends at 28px (excluding transparent padding) as the Zillion wordmark fades
out; both reverse when scrolling back. Contact avatars mount as they approach
the visible strip, using thenameisf's visibility task with an 84px preloading margin.
Light and dark themes follow the system; backgrounds are off-white and graphite.
The same logo artwork serves both themes and the launcher icon; its sources and
safety padding are documented in [design/branding](design/branding/README.md).
Preview content uses fixed English source keys translated at render time, with
local portraits. Contacts and conversation rows open a fixture DM, including a
conversation with yourself. Search, compose, profile and More are still inert. Real user messages will
not pass through the preview translation catalog.

The shared [toast](src/components/shared/toast.md) supports success, error,
warning and info, expandable details and navigation through unique notices. It
stays centered inside the same mobile column and follows locale/theme changes.
Import its helpers from `#shared/toast.js`; the app root mounts its host once.

Typography follows 44billion: the root font is `0.0625em` and body text is
`16rem`. Author font sizes in `rem` (`16rem` is normally 16px) and fixed layout
dimensions in `px`, allowing the browser's preferred font size to scale text.

## Conversation preview

`/chat/:contactId` opens a sample conversation (`maya`, `daniel`, or `user` for
self chat, for example). The floating header, incoming/outgoing bubbles,
quotes, reactions, link cards and composer use the same 718px column and theme.
Message long-press, right-click or Shift+F10 reveals Reply, Share/Copy and Delete
above the messages. Sharing uses the browser API when available, otherwise it
copies text and briefly displays a checkmark on green. Cancelling native sharing
does not copy; other failures can fall back to the clipboard.

The text area grows up to five lines, then scrolls internally. Enter inserts a
newline. Typing hides Attach and replaces Camera with Send. Sending, replying,
deleting, attachments, camera capture and paid attention are still unimplemented;
drafts are temporary component state. The three-dot menu displays the future
content-deletion action without performing it. Paid attention (the bolt button
and menu option) is available only with the development flag described below.

Use `/chat/maya?entry=1` to make a specific conversation the initial screen for
an embedded app. Its logo replaces Back and has no action yet; this UI offers no
link to the home screen. Ordinary conversations return to home through browser
history, with a home fallback for direct entry. Routes survive reloads. The query
parameter controls navigation UI; opening Zillion through another app remains
future integration work. See [chat fixtures](src/components/views/chat/fixtures/README.md).

Navigation retains views within four history positions in either direction,
matching Flame's limit. Returning restores the same view, including home scroll,
the collapsed header, contact-strip position, chat scroll and unsent drafts.
Views beyond that distance, replaced entries and discarded forward history are
unmounted; reloads start fresh. Revisiting a URL at another history position
replaces its older cached instance.

At widths up to 718px, forward navigation slides the incoming page from the
right with a light fade; Back slides the outgoing page to the left. These 150ms
transitions use the native Web Animations API with transforms. Initial loads,
replacements, desktop widths and reduced-motion preferences skip the animation.
Inactive views remain mounted but cannot receive focus or pointer interaction.

Route retention requires **thenameisf 1.2.10** or newer.

## Development

Paid attention is hidden by default. Run `ZILLION_CHAT_ATTENTION=1 npm start`
to preview its header button and menu option, or `ZILLION_CHAT_ATTENTION=0 npm start`
to hide them. Restart the watcher when changing this build-time flag; it also
applies to other development commands. Production builds always omit both
controls, even with the flag set to `1`. Without them, the three-dot button
occupies a single 44px circle with no reserved space for the bolt.

Requirements: Node.js 24+, npm, Python 3, and the `44billion` and
`ez-vault` repositories with their npm dependencies installed. Chrome is also
required for browser tests (`CHROME_BIN` overrides `/usr/bin/google-chrome`).

The workspace keeps this app at `repositories/napps/zillion`, alongside
`napps/nappstore`. Tooling resolves `44billion`, `ez-vault`, and `nappup` from
`repositories/` (two levels above the Zillion root).

```sh
npm install
npm run link:nappup       # needed only for real publishing; repeat after switching Node or npm ci
npm start                 # local launcher + watch + installation without publishing
npm run start:publish     # watch + real draft publishing after two seconds
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
Open the printed local URL once in each browser to install and follow updates.

For Android, install Android platform-tools, enable debugging, authorize the
computer, and check `adb devices`. Run `npm run start:adb`, then open the printed
local URL in Chrome/Edge on the phone. The script forwards ports 10000 and 4000
with `adb reverse`; esbuild's port 8080 stays internal. The phone uses its own
browser storage and vault accounts. Local updates preserve app data.
Use `start:publish:adb` for Android with real draft publishing instead.
Use `-- --debug` for verbose console logs or `-- --browser=edge` to prefer Edge.
Set `ANDROID_SERIAL` to select a device; an already paired/connected wireless ADB
device works too. The console uses an automatically assigned host port unless
`CDP_PORT` is set. Ctrl+C releases only mappings created by that session.

Local builds are installed after a 250 ms debounce, with one installation at a time
and only the latest pending build retained. No nappup, publisher credentials, CDP,
or remote upload is required. The regular browser downloads immutable files from
the local launcher, verifies their hashes, and stores them before activating the
manifest. Failures keep the previous build working. The app iframe reloads at its
current route while its IndexedDB, eventStore and permissions survive.

The development publisher identity is kept in `tmp/local-dev/identity.json`.
Keep this private ignored file to retain the local URL and app data across restarts;
it is separate from your real publisher. Invalid identity files fail explicitly.
The local app remains cached when the watcher stops and is excluded from remote
updates. The app's launcher menu offers **Clear local app data and reload**, with
confirmation and a scope limited to that app and the selected user. Other open
instances of that user/app pause during the reset. Failed cleanup is reported.

`start:publish` retains the two-second debounce, isolated upload files and shared
`tmp/upload.lock` used by `upload:draft`. It publishes to the real network. If an
uploader is forcibly killed, remove a stale lock only after confirming its process
has stopped. Changes to build scripts or dependencies require restarting watchers.

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
portraits are intentionally included for visual review; navigation and message
sharing use those fixtures, and no real identity, contacts, or messages are read.
`serve` supports SPA routes but provides no injected launcher APIs.

## Publishing

Zillion will be a static site published as an **nsite** (also called an app,
napp, or Nostr app), following [NIP-5A — Named Sites](https://github.com/nostr-protocol/nips/blob/master/5A.md#named-sites).
The project's runtime environment **does not support service workers**.

`npm run upload` compiles and publishes to **main** using the installed nappup.
`npm run start:publish` and `npm run upload:draft` publish only to **draft**, with identifier
`zillion`. All three publish to the real network, even with a local launcher.
Publisher identity and upload options follow [nappup](../../nappup/README.md).

Publishing uses the sibling `../../nappup` checkout, whose dependencies must be
installed. Run `npm run link:nappup` here after initial setup, switching Node/npm,
or `npm ci`. The script registers the checkout globally for the active Node
installation, then restores this project's local package/CLI link without saving
it in the lockfile. Zillion intentionally has no registry dependency on nappup.
Restart an active watcher after changing the link.

Linking shares uploader code, not credentials. Local development uses the shared
encrypted file `~/repositories/napps/.env` for Zillion and other nsites/apps. Configure the
shell running `start:publish` or `upload:draft` (and restart existing watchers):

```sh
export DOTENV_CONFIG_PATH="$HOME/repositories/napps/.env"
```

Supply its matching `DOTENV_PRIVATE_KEY_NAPPUP` when required. The Zillion-local
`.env` has been migrated to that shared file; do not create a new publisher identity
by running without this configuration. Other environments may choose another
absolute path. This is private local configuration, never app metadata or build
input. Changes to the shared credential affect every project using it.

The build converts [`napp.jsonc`](napp.jsonc) to `.well-known/napp.json`, which
nappup consumes as metadata and excludes from published files. This format is
an ecosystem convention; document customizations separately from NIP-5A.

See [`AGENTS.md`](AGENTS.md) for architecture and contribution guidelines.
Keep both documents updated alongside the changes they describe. Write all
project documentation and code comments in English.
