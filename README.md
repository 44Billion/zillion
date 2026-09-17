# Zillion

A private chat inspired by WhatsApp and Signal, built as a Nostr client.
Messaging will use [`libp2r2p/private-messenger`](../../libp2r2p/private-messenger/index.js),
which combines private messages (`private-message`) with transport over private
channels (`private-channel`). The entire front-end uses **thenameisf**.

The project is just getting started: this repository contains documentation,
tooling, localized home and conversation previews with fixed sample DMs, a reactive toast, and
reusable avatar/cache foundations.
Self chat uses the logged-in account and persists text (kind 9) and local file
metadata (kind 1063) as personal copies in the launcher event store, with live
updates, replies and NIP-27 media rendering. Third-party conversations remain sample data.

Self-chat text uses `libp2r2p/nip27.compactWhitespace` before sending and for
displaying history, reply excerpts and conversation previews. Spaces and tabs
collapse, runs of three or more line breaks become two, and only eight line
breaks remain overall. Existing stored events are not rewritten. Bubbles keep
`white-space: pre-wrap` for the remaining formatting; no original-text toggle
is shown.

Zillion will run as a SPA inside the **44billion launcher**, using its
[committed injected API contract](https://github.com/44Billion/44billion/blob/main/APP_API.md).
Startup identifies the instance's fixed user through `window.nostr.peekPublicKey()`.
Personas will expand known-contact discovery, while the inbox remains limited to
that user. Routing uses the browser History API through thenameisf's
`useLocation` and `f-route`. Reactive i18n follows the launcher's initial locale
and subsequent changes in all 11 supported languages. Widget integration is out of scope.

Zillion is **offline-first**: the launcher loads the installed app, Nostr events
and private-message personal copies belong in `window.napp.eventStore`, and
image bytes use `libp2r2p/idb-queue` (IndexedDB). `temporaryStorage` is reserved
for disposable session data. Cached content renders before remote refreshes;
uncached avatars use a generated fallback. HTTPS images need a successful
CORS download to be reliably available offline. Avatars have a dedicated 16 MiB
FIFO cache; chat images, previews and thumbnails share a separate 64 MiB FIFO
cache. Both store decoded dimensions. Conversation media cannot evict avatars
from their reserved budget. External videos render online and remain links offline. Local attachments,
including videos, use launcher storage instead of these HTTP caches.
Remote uploads and third-party messaging remain planned.

## Home preview

The home follows one mobile layout, capped at 718px and centered on wider screens.
It includes the green chat-bubble Z logo, top-right profile portrait, a horizontal contact
strip (pinned first, then alphabetical), and a DM list sharing its unread counters
with contact avatars. Touch scrolling snaps to
whole contacts; mousewheel and arrow keys move by contact. When future-feature
previews are enabled, More stays fixed in the strip; otherwise contacts occupy
the freed space. The header and the strip divider remain visible during vertical
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
real conversation with yourself. Search, new-conversation, profile and More
remain previews. Real user messages never pass through the translation catalog.

The shared [toast](src/components/shared/toast.md) supports success, error,
warning and info, expandable details and navigation through unique notices. It
stays centered inside the same mobile column and follows locale/theme changes.
Import its helpers from `#shared/toast.js`; the app root mounts its host once.

Typography follows 44billion: the root font is `0.0625em` and body text is
`16rem`. Author font sizes in `rem` (`16rem` is normally 16px) and fixed layout
dimensions in `px`, allowing the browser's preferred font size to scale text.

## Conversation preview

`/chat/:contactId` opens a sample conversation (`maya` or `daniel`, for
example); `/chat/user` opens the real self chat. The floating header, incoming/outgoing bubbles,
quotes, reactions, link cards and composer use the same 718px column and theme.
Message long-press, right-click or Shift+F10 reveals Reply, Share/Copy and Delete
above the messages. Sharing uses the browser API when available, otherwise it
copies text and briefly displays a checkmark on green. Cancelling native sharing
does not copy; other failures can fall back to the clipboard.

Initial self-chat history keeps the scroll at the latest message while media
loads, without growth animations. Scrolling up preserves the reading position
as earlier media expands. After initial loading, visible media and preview
changes animate briefly, respecting reduced motion. URL `#dim` hints reserve
space; otherwise media dimensions are prepared before presentation. Day
separators retain their identity as earlier messages arrive. Bottom following
also aligns fractional layout positions with scroll pixel rounding, keeping
unchanged text bubbles from shifting by a pixel as history grows.

The text area grows up to five lines, then scrolls internally. Sending immediately
clears the accepted draft and returns the field to one line. Enter inserts a
newline. Self chat always exposes Attach, including while typing a caption;
Send accepts either text or a prepared file. Other chats retain the future-feature
preview controls, where typing hides Attach and replaces Camera with Send.
Sending, attachments and replying work in self chat;
deletion, camera capture and paid attention remain unimplemented;
drafts are temporary component state. The three-dot menu displays the future
content-deletion action without performing it. Paid attention (the bolt button
and menu option) is available only in third-party fixture chats with the
development flag described below; self chat always hides both.

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

Future-feature previews are enabled by default in development (`npm start`).
Run `ZILLION_FUTURE_FEATURES=0 npm start` to hide them, or
`ZILLION_FUTURE_FEATURES=1 npm start` to enable them explicitly. Restart the
watcher when changing this build-time flag; it also applies to other development
commands. The flag controls Search and New message beside the home avatar,
More in the contact strip, the paid-attention header button and menu option,
Attach, and Camera. These controls are still inert previews.

Production always omits these controls, even with the flag set to `1`.
The contact list expands into More's space, the three-dot chat button occupies
a single 44px circle, and the composer always shows Send instead of Camera.
Sending works in self chat. The profile button remains visible.

Toast history supports keyboard focus: expiry pauses while browsing its controls
and resumes with an extended timeout when focus leaves.

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
Above it, the development-only **Reset development environment and reload**
deletes every vault account and all local data of every app in that browser and
reloads; it aborts with an error when the vault is unreachable. Reopen the
printed local link afterwards to reinstall the app files.

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


## Self chat

`/chat/user` belongs exclusively to `window.nostr.peekPublicKey()`. Messages use
`window.napp.eventStore.addPersonalCopy(template, { context: 'dm:<own pubkey>' })`;
they never use private-messenger or relay publication. Replies use `q` with the
inner event ID, an empty relay hint and the owner's public key. Identical sends
in the same second remain distinct. Accepted sends appear immediately with a
static clock replacing the time. A failed save shows a red alert; tap it to
choose the green Retry icon. Icons occupy only their own width. Confirmation smoothly expands
that space to reveal the time, including any resulting bubble height change.
Contraction is immediate; initial history and reduced motion skip the animation.
Retries reuse the original event and never overwrite a newer draft.
Pending and failed messages live in memory across retained routes; reloading
the app or restarting the account service discards any that were not saved.
The app root owns history/profile subscriptions and cleans them up on unmount;
home's self avatar and last-message preview share that state.

Every new message is kind 9. Sending an image or file writes its kind 1063
first, then a kind 9 whose content is a NIP-21 `nostr:nevent1…` URI (kind and
author, no relay hints) plus any literal text; the text typed for an attachment
lives only in the kind-1063 caption. Replies reference the replied message the
same way, so an image reply carries two URIs and two `q` tags in order. The feed
renders kind 9 only: a reference to a kind 9 becomes a quote, one to a 1063
becomes the attachment card in the URI's position, and a `q` tag without a URI
renders before the text. References resolve lazily from pending sends and the
local store (never relays); unsupported or unresolved kinds keep the compact
inline link. A rendered caption sits below the download row, italic, muted and
clamped to two lines, expanding two lines per click.
The first whitespace run that separates an expanded quote or attachment from the
rest of the bubble is structural: a space or tab never indents the next line and
a single line break never paints as an empty line, while an authored blank line
(`\n\n`) still does.

The companion launcher must expose NIP-44 v3 plaintext as `ArrayBuffer`, matching
the NIP-07 extension. Self chat decodes those bytes directly as UTF-8 JSON.
The local launcher/vault channel keeps those bytes binary; Base64 is confined
to remote bunker requests and the vault's encrypted activity-log fields. Update
the launcher, vault and app together; existing encrypted messages do not need migration.

Use the companion 44billion update supporting `subscribe(filter, { initial: true })`
to close the history/live delivery race. This new option is not yet in the
committed upstream API. Offline signing also requires the companion ez-vault
update for local content keys. Remote bunker signers require connectivity.
The existing identity, personal-copy write and signer
APIs were verified against upstream. The launcher's vault handles eventual
device synchronization; Zillion consumes the resulting local updates.
Generic private account lists will use context `''`; self chat never queries it.
Third-party profile caches retain local-first reads and relay refreshes.
Deletion, reactions, remote uploads, history pagination and third-party transport
are not implemented. External video bytes are not cached for offline playback;
local video attachments are stored by the launcher.

Real messages use the same bubble spacing as fixtures, with clock-only timestamps
and localized day separators. HTTPS links show Open Graph cards when the remote
site allows browser CORS reads, or a declared icon/default favicon otherwise.
Requests omit credentials/referrers and have size, timeout and concurrency limits.
No preview proxy is configured: CORS-blocked metadata cannot be rendered.
Preview metadata is cached in memory; image bytes reuse the disposable media cache.
Unsupported Nostr event pointers use njump.me where accessible, retaining their
original destinations. Reference extraction uses libp2r2p 0.10.17 or newer;
encoded and named app references, including `+apps`, render as accent-colored
links to `44billion.net`, opening in a new tab. Named links omit the root author
`_@44billion.net` (including its compact spelling), so `+example@44billion.net`
opens `https://44billion.net/+example`. Other authors and channels are preserved.
App references do not fetch previews or resolve authors while being displayed.
URLs with `+` in their paths are also recognized. URLs, apps and NIP-19 labels are shortened
to about 22 characters, without underlines; full references remain available in
tooltips, accessible link names and copied/shared text. Reply quotes and the
composer's reply summary use the same compact labels. The composer allows two
lines beside a fixed cancel button and shows at most one media thumbnail, reusing
the image/metadata caches and Nostr privacy checks.
Posted reply quotes use a smaller 38px thumbnail beside the author and a single
excerpt line, with ellipses for overflow.
Loaded previews stay mounted when unrelated messages arrive or retained routes
become inactive.
Known personal-copy references never go
to njump; an unavailable local provenance check or missing remote page also keeps
the plain Nostr link. Sample-chat link cards remain static fixtures.

## Local self-chat attachments

The paperclip selects one file. With previously confirmed images/videos it opens
an ordered gallery first; its first tile opens the native file picker. An unknown
or unavailable history opens a recovery panel: add-file plus three loading tiles
in one row, then the catalog or a Retry tile. Loading, failure and retries keep
the same panel height. Recovery keeps its loading row visible for at least two
seconds, even after a quick result; closing the panel remains immediate. Reduced
motion disables the shimmer. Unlocking
the vault can be followed by Retry or reopening the panel; restarting Zillion is
unnecessary. A confirmed empty catalog opens the picker, while an empty result
arriving in an open panel leaves just its add-file tile. Closing the panel stays
closed even when the query finishes later. Conversation and gallery retries
share recovery and preserve the same account's outbox and prepared attachments.
The catalog is a dedicated newest-first read of the account's kind-1063 personal
copies in the self-chat context; they are decrypted before the existing
image/video, dimension and unique-root filters, so files sent before this change
stay reusable.
A selection
prepares a preview and MMR tree, shown above an optional caption. **Nothing is
stored until Send.** Changing/removing the selection preserves caption and reply.
While preparing, a compact opaque cancel button sits to the left of the status.
The open gallery highlights its paperclip. The selected attachment uses a square
preview matching one gallery tile, with an internal remove control, localized
size and an extension-preserving filename. Truncated labels show `name…pdf`;
full labels keep `name.pdf`. Each label is a single text run, so the extension
follows the ellipsis directly. File replies flow filename and caption inline, with
subsequent caption lines returning to the same left edge. The composer stacks
reply, selected attachment, and open gallery in that order. Unsupported previews use a soft
category-colored file icon in the composer; bubbles retain download cards.
Attachment bubbles fit the available width (160–320 px when possible) and cap
media height at 360 px without cropping.

Text uses kind 9. A file writes a kind-1063 personal copy in `dm:<own pubkey>`
followed by the kind 9 that references it: caption in the 1063 content; `url`,
`r`, `m`, `size`, `service=irfs`, and verified `dim` / Base64 `thumbhash` when
available. The URL is `https://nostr.alt/nfile1…?localOnly=1`. Chunks use the
launcher's existing public-local 34601 model with separated bytes; the personal
copy's `r` retains them. They are not uploaded to relays or encrypted.

Pending/error bubbles use the existing outbox and Retry. Each attempt preserves
the same metadata and kind-9 events with their timestamp, skips existing chunks,
confirms local bytes, then saves the 1063 before the 9 that quotes it. Gallery
reuse writes new metadata without duplicating bytes. Partial chunks remain under
the launcher's normal cleanup. Empty files are rejected; files with
failed/unsupported previews remain sendable/downloadable.
Drafts and failed outbox entries remain memory-only and disappear on reload.
Confirmed attachments survive according to launcher storage retention.

Local attachments read original bytes from nostr.alt outside the HTTP image cache
and connectivity probes. Composer, bubbles, gallery and replies reuse reduced
previews (at most 320px) instead of decoding the original again. The 8 MiB / 128-entry
FIFO supplies cached gallery previews synchronously with a stable shared URL;
eviction/replacement revokes it only after every consumer releases it. Reopening
a cached tile therefore needs neither a placeholder transition nor another read
of the original. Gallery cells reserve their squares in the parent layout and
read reactive metadata directly by root, so reopening does not briefly lose
its rows or cached thumbnails during item-adapter remounts. Video players
use the small poster and load the original only for playback. Preview preparation
runs serially: PNGs are reduced scanline by scanline, JPEGs request native scaled
decoding, and videos use MediaBunny. Disposable image Workers and MediaBunny's
Workers run inside the launcher; cancellation releases their resources. Other
native image decoders still have format-dependent memory costs. Compression is
not enabled; the original File supplies both upload bytes and the MMR root. Native downloads use the instance-bound URL from
`window.napp.getFileDownloadUrl`, streamed by the launcher without a file-sized
Blob. Closing that instance may interrupt downloads; these local downloads are
not promised outside the launcher. Copy/share includes caption and full nostr.alt
URL. No file-specific quota policy is added in this release.

This checkout consumes the public APIs from the published `libp2r2p@^0.10.18`
range, with the resolved release recorded in package-lock.json. No vendored tarball or
sibling source imports are required.

The local Chrome validation and remaining device coverage are recorded in
[docs/local-attachments-validation.md](docs/local-attachments-validation.md).
Gallery recovery and frame sampling are recorded in
[docs/attachment-gallery-validation.md](docs/attachment-gallery-validation.md).
Run `npm run test:browser:attachments` for the focused integration checks, or
`node ../../44billion/bin/run-browser-tests.js -- node --test tests/browser/self-chat.browser.js`
for the full self-chat regression.

Incoming kind-1063 `download` intent is honored: a bare tag or value `1` makes
image/video thumbnails download links; absence or `0` keeps normal media behavior.
Inline URLs accept explicit `#download=1`, including nfile URLs. Reply/quote
thumbnails follow the same intent. Videos in download links expose no player
controls. Gallery tiles still select an attachment for composition. Zillion
omits the tag on sends and gallery reuse for now.
Local downloads use the launcher stream. External URLs use native links and
require server `Content-Disposition: attachment` to guarantee a cross-origin
download; the app does not fetch files into Blobs or force playback/fullscreen.

Browser npm scripts require Linux user systemd and run the complete test tree
under a 3 GiB memory limit, without swap. Stop existing local runtime processes
first and run only one suite at a time. The runner reports its observed peak
and terminates descendants after failure/timeout; it has no unbounded fallback.

See [download intent and memory validation](docs/download-intent-and-memory-validation.md)
for the measured browser peak, audit-log correction and coverage limits.

Attachment presentation checks and browser/memory limitations are recorded in
[docs/attachment-presentation-validation.md](docs/attachment-presentation-validation.md).

Implementation, measured memory bounds and remaining limitations are recorded in
[docs/media-preparation-validation.md](docs/media-preparation-validation.md).
The preceding preview memory research is recorded in
[docs/media-memory-experiments.md](docs/media-memory-experiments.md), with the
[follow-up variant tests and future compression plan](docs/media-memory-variants-and-plan.md).


New picked images, audio and video are compressed automatically before preview
and IRFS preparation. The shorter oriented side selects 1080/720/480px, without
upscaling or cropping. Opaque images use JPEG .7, transparent images and
animations use WebP .7, mono/stereo audio uses MP3 128 kbps, and video uses
MediaBunny medium-quality H.264/AAC in MP4. Animation timing/looping is retained;
video alpha/HDR follows MediaBunny defaults. Unsupported, unsuccessful or larger
outputs keep the original. Cancel stops the whole selection.

Encoded outputs stream to temporary OPFS files with explicit ownership through
composer/outbox and retry. They are removed on cancellation, removal or confirmed
send. Abandoned-session cleanup starts two minutes after mounting the app,
without requiring a chat or a new upload. If hidden, it waits until visible.
Subsequent visible returns and 30-minute intervals request maintenance; failed
removals retry after 10s, 1min, 5min, then every 30min, respecting visibility.
Web Locks protect live files and prevent simultaneous scans across tabs.
Preparing an attachment does not trigger a scan; closing the app defers cleanup
to its next opening. Only final
bytes determine the filename, MIME, dimensions, ThumbHash and nfile root. History
reuse does not recompress. `prepareAttachment(file, { compress: false })` is the
internal opt-out; there is no user-facing switch yet. Downloads remain native.
See [compression validation and limitations](docs/media-compression-validation.md).
