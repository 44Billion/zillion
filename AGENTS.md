# Zillion

A Nostr client for private chat inspired by WhatsApp and Signal. The project
has real self chat alongside fixture-backed third-party DMs, avatar/cache
foundations, and build/publishing tooling. Do not describe planned features as already implemented.

## Living documentation

- Write all project documentation and code comments, including JavaScript and
  JSONC comments, in English. Apply this rule to new content and updates.
- Update `README.md` and this `AGENTS.md` in the same change that modifies
  commands, architecture, conventions, integrations, or limitations. Review
  both when completing a task; avoid cosmetic edits when nothing has changed.
- Keep the README concise and focused on purpose, current status, and usage.
  Record lasting implementation decisions here; local details may live in
  documents near the code. Read applicable `AGENTS.md` files before editing.
- Other projects' documents are references: their instructions do not
  automatically become Zillion rules. Distinguish this project's requirements,
  library contracts, and external specifications.

## Nostr and messaging

- Before implementing any Nostr behavior, check the public exports and
  implementation of the installed `libp2r2p` and, when needed, the sibling
  repository `../../libp2r2p`.
- In order of preference: reuse a public API; consider exposing an internal
  implementation through a public API; or add a capability to libp2r2p that
  other projects can reuse. Keep only app-specific helpers/services in Zillion.
- Do not import unexported internal files or sibling repository paths in
  production code. When changing the library, follow its `AGENTS.md`, validate
  there, and ensure the version consumed by Zillion includes the API.
- The primary integration will be `createPrivateMessenger` from
  `libp2r2p/private-messenger`; read its `index.js` and documentation before use.
  It coordinates `private-message` over `private-channel`. Do not reimplement
  cryptography, transport, or recovery already provided by the library.
- Keep messaging orchestration outside visual components. Use the launcher
  identity contract below; define channel setup, persistence, and lifecycle
  when implementing the integration.

## 44billion runtime

- Zillion runs inside the **44billion app launcher**. Treat the committed
  [`APP_API.md` on `main`](https://github.com/44Billion/44billion/blob/main/APP_API.md)
  as the source of truth for injected APIs; check it when introducing or changing
  an integration. New injected APIs must be documented there. The sibling
  `../../44billion/APP_API.md` and implementation are useful for development, but
  local changes do not prove availability in the deployed runtime.
- `window.napp` and `window.nostr` are injected before app JavaScript runs;
  asynchronous bridge methods wait for the handshake. Use these APIs directly
  in the launcher. A standalone dev server does not inject them.
- `window.nostr` implements [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md)
  plus the extensions documented by the launcher. Call
  `window.nostr.peekPublicKey()` as early as possible during startup for autologin
  and use its result as the current user. `peekPublicKey` is a launcher extension,
  not a standard NIP-07 method.
- Each user/app combination has its own subdomain. The instance's primary user
  stays fixed; persona selection does not change `window.nostr` or imply account
  switching. Multi-user inboxes are out of scope: never display messages received
  by other members of the same persona.
- Use `getPersonaPublicKeys()` and `onPersonaPublicKeysChanged()` to track which
  accounts are accessible. `getWindowNostrFor(pubkey)` obtains a signer for an
  accessible member; normal permissions and account restrictions still apply.
- `window.napp.eventStore` belongs to the primary user and app. The companion
  launcher exposes `window.napp.getWindowNappEventStoreFor(pubkey)` with the
  same store API for a persona member, verified in the committed upstream contract.
- Use accessible persona members' event stores to expand the set of known
  contacts. Open communication channels only for contacts known to the primary
  user or the corresponding persona. Broader contact discovery does not authorize
  receiving or presenting another member's inbox. Reconcile channels and release
  subscriptions when available persona members or known contacts change.
- Widget APIs and widget-specific UI are out of scope.
- Locale comes from `window.napp.getLocale()` and `onLocaleChanged()`. Wire the
  initial locale and subsequent changes into `#f/i18n/reactive` using one
  `createI18n` instance and one root `useI18nProvider`. Use `getT`/`useT` for
  translations, update the instance with `setLocale`, and clean up the launcher
  listener on unmount. Do not let an app-local persisted preference override the
  launcher; define supported locales and an explicit fallback. Avoid applying a
  stale initial read after a newer locale notification.
- `src/i18n/index.js` owns the reactive instance and `useInitI18n`, mounted once
  by `z-app`. Subscribe only to `onLocaleChanged`: its initial notification
  supplies the handshake locale, so no separate asynchronous read can race it.
  Support `en`, `fr`, `it`, `de`, `es`, `pt-BR`, `ru`, `zh-CN`, `zh-TW`, `ja`,
  and `ko`, with English until the handshake and as the explicit fallback.
  Synchronize `html.lang`; do not configure browser preference storage.
  Catalogs use source English keys and explicit locale objects, validated by
  thenameisf. Translate during render through `getT`/`useT` so text stays live.

## Offline-first data and media

- The launcher can load an installed Zillion offline. App data must also work
  from local storage; do not gate local reads/writes on internet connectivity.
  No service worker is available.
- Use `window.napp.eventStore` for complete Nostr events, reading local data
  first and refreshing from relays independently when appropriate. Cache signed
  profiles as their original kind 0 events, preserving event ordering and signatures.
  Permission or storage failures are separate from network failures.
- Persist directly received private-messenger rumors with
  `await window.napp.eventStore.addPersonalCopy(unsignedEvent, { context: 'dm:<peer pubkey>' })`.
  Replace the placeholder with the actual conversation peer's public key.
  Direct authenticated delivery uses the default `hearsay: false`; use
  `hearsay: true` only for actual third-party hearsay. Read the launcher's
  personal-copy contract before integrating retrieval and provenance filters.
  Both peers can construct channel messages: do not add a sender signature or
  present a personal copy as cryptographic proof of authorship. Preserve the
  primary-user-only inbox policy even when other persona stores aid discovery.
- Use `createQueue` from `libp2r2p/idb-queue` for disposable persistent media
  caches. Its IndexedDB indexes, byte budget, and eviction replace the custom
  nappstore LRU. It is a queue, not an automatic LRU; choose the eviction policy
  explicitly. Account for image bytes: a Blob's JSON representation is not an
  adequate estimate for the queue's logical byte limit.
- `libp2r2p/temporary-storage` remains suitable for ephemeral, disposable data.
  Its default is sessionStorage; it is not the persistent offline media cache.
- `src/services/media-cache.js` owns database `zillion:media:v1:idb-queue`,
  managed by libp2r2p with `items` and `state` stores and a unique `url` index.
  Records contain `{ url, dataUrl, width, height }` with decoded image dimensions;
  the logical budget is 64 MiB with FIFO eviction and a 4 MiB download limit per image before base64 encoding.
  Cache hits remain usable offline until evicted or explicitly cleared; there
  is no freshness/TTL policy yet. Do not put message history in this cache.
  `get`/`resolveImage` return `{ source, width, height }` or `null`. Decode
  downloads before persisting; cached dimensions avoid a network/decode step on
  offline reads. Native CORS fallbacks must decode before presentation and are
  never persisted. Preparation (including cache reads) has a 15-second deadline.
  There is no legacy-record migration; use a clean disposable cache for testing.
- `src/services/avatar-cache.js` reuses `createMediaCache` with an independent
  16 MiB FIFO queue in `zillion:avatars:v1:idb-queue`. Every `a-avatar` resolves
  pictures through this instance. Chat images, preview images/icons and reply
  thumbnails keep the existing 64 MiB media queue (80 MiB total logical budget).
  Both queues share the record/decoding contract and 4 MiB download limit;
  eviction and clearing are independent, including when URLs are identical.
  Do not migrate avatar bytes from the old shared cache or fall back to it.
- `a-avatar` starts from nappstore's component. Preserve its public props,
  image lifecycle, and deterministic DiceBear fallback while improving it.
  Zillion replaces its default LRU with event-store profile reads and IndexedDB
  image bytes. Optional `profileCache` remains a synchronous get/set/remove
  adapter; fallback memory is only for the mounted avatar, not durable storage.
- Resolve cached images before HTTP. Fetch readable image bytes with CORS,
  omitted credentials, bounded sizes/timeouts, and cancellation. A server may
  allow an online `<img>` while denying CORS downloads; do not promise offline
  persistence for that case. Storage denial/quota must not break the UI.
- For message media, show a link when image bytes are unavailable
  offline and upgrade to a rendered image after confirmed connectivity. A URL
  alone is not a locally cached image. Avatars use their generated fallback.
- Use `isOnline` and `onOnline` from `libp2r2p/network` for remote work. The
  companion library change gives `onOnline` a shared probe/retry monitor;
  consumers own their work queues, not duplicate connectivity probe loops.
  Probes cannot guarantee any particular relay/server is reachable, nor can
  background timers guarantee immediate detection. Handle each request failure
  and clean up listeners, timers, and stale async work when consumers unmount.
- The installed libp2r2p 0.10.11 includes the shared connectivity monitor.
  Validate against the lockfile-managed dependency; do not require a sibling link
  for this capability.

## Front-end

- The entire front-end must use **thenameisf**, in JavaScript ESM.
- Whenever a task involves front-end work, read and apply the `thenameisf` skill
  and relevant references before implementing or reviewing. In this workspace:
  `/home/arthur/.codex/skills/skills/thenameisf/SKILL.md`; in other environments,
  locate it in the skills catalog. This summary does not replace that reading.
- Use functional components `f('z-tag', ({ h, props }) => ...)`, `useStore` for
  state, `useTask` for effects, and reactive props as signals ending in `$`.
  Use `#f` and `#f/*` imports; do not introduce another UI framework.
- Keep `src/assets/html/index.html` as the shell and `src/components/app.js`
  lean. Zillion is a **SPA using the browser History API** with pathname URLs.
  Use thenameisf's `useLocation` and `<f-route>` (imported from
  `#f/components/f-route.js`) with `url-router`; do not introduce hash routing
  or copy the legacy `a-route` component. Keep the router in
  `src/components/router.js` and screens in
  `#views/*`, similar to nappstore. Follow the current skill's routing contract
  rather than copying older component syntax. Navigate with the location store's
  `pushState`/`replaceState`/`back`/`forward` methods instead of bypassing the
  location store with raw history mutations. Read route data from `props.route$`
  or `useClosestStore('<f-route>').route$`. Validate direct-route loading,
  reloads, and browser Back/Forward; serve the app shell for SPA route URLs.
- Scope component style selectors to the host or component root; account for
  accessibility, keyboard use, and small screens.
- Typography follows 44billion: `html { font-size: 0.0625em }` and
  `body { font-size: 16rem }`, so `1rem` is approximately `1px` with the default
  16px browser font. Use `rem` for authored `font-size` only; use `px` for fixed
  layout dimensions, spacing, borders, and icons. Relative layout units and
  unitless line heights remain valid. Preserve browser font preference scaling.
  `--z-mobile-width: 718px` is shared by the home column and toast.
- Mount one `z-toast` in the stable app root. Import `show`, `close`, `success`,
  `error`, `warning`, or `info` from `#shared/toast.js`; do not create DOM toast
  instances. The reactive port preserves ez-vault's unique history, navigation,
  expandable details, animations, and 4s/8s timing. Component tasks own timers
  and clear them on unmount. See `src/components/shared/toast.md` for the API,
  text callbacks, accessibility behavior, and duplicate identity rules.
  Bind bubbling focus events with `@focusin`/`@focusout` listeners; their `on...`
  forms can become stringified HTML attributes instead of native handlers.

## Home layout preview

- Home uses real self-chat state alongside third-party JSON from `src/components/views/home/fixtures/`.
  This visual preview deliberately ships sample data and local portraits. It is
  separate from browser-test fixtures, which remain excluded from publication.
- Third-party preview contacts do not fetch real contacts or messages; self identity
  and history use the runtime. `a-avatar`
  receives provided data-URL profiles without public keys, so no Nostr lookup is
  triggered. Contact and conversation controls navigate to fixture DMs or real self chat.
  Home Search and compose remain inert; the profile portrait opens the account
  profile and More opens the contacts view.
- Keep the main column at a maximum of 718px, centered with vertical borders on
  wider screens. Use the same mobile composition at every width. The contact
  strip fits whole items while keeping 44px portraits. More occupies the final cell when all other visible cells are filled. Otherwise
  Add Contact immediately follows the existing contacts inside the scroller.
  Both actions are independent of future-feature flags and use translated,
  ellipsized labels. ResizeObserver derives whole slots from the strip width.
- Sort contacts pinned first, alphabetically within each group. All contacts,
  including pinned ones, scroll; only More stays outside the scroller. Share
  unread counts with their conversations through `z-unread-badge`.
- Use native horizontal scroll snap for touch inertia and whole-contact wheel
  destinations; respect reduced motion. The header is sticky and a separate
  sticky divider preserves the contact strip's bottom edge below it. After the
  divider reaches the header, the next 96px of scroll synchronously shrink its
  padding and square logo. The minimum is 48px including the divider, plus the
  device's top safe-area inset; action hit areas stay 44px high. The logo box
  ends at 28x28px while the Zillion wordmark fades to zero opacity using the same
  progress. Keep its semantic heading and layout space while faded. Keep an
  expanded flow slot so this visual change cannot alter the collapse threshold
  or trigger scroll-anchoring jumps.
- The approved logo is the green organic chat bubble with a Z. Use the same
  `src/assets/media/branding/zillion.icon.svg` in both themes without tinting. It embeds
  the transparent raster unchanged with 10% safety padding on each side. The
  header compensates with a 125% image size: the longest visible bubble dimension,
  including its tail, is 28px when collapsed. Keep the semantic logo box at 28px.
  `design/branding/README.md` records sources and sizing; design files stay out
  of builds. The HTML icon declaration also supplies the launcher icon via nappup.
- Mount contact avatars only near the horizontal viewport using `useTask` with
  `when: 'visible'` from thenameisf 1.2.9 or newer. Pass the contact scroller's
  element ref from the parent as `scrollRoot$` and use `rootMargin: '0px 84px'`.
  The task observes the contact's visual root automatically and stops observing
  after enabling the avatar. Do not restore the custom IntersectionObserver.
  Preview portrait bytes remain bundled data URLs; this defers avatar mounting
  and image decoding, not downloading those fixture bytes.
- The upper-right profile portrait matches the 26px action icons; the upper-left
  logo bubble starts at 42px. Inbox rows are DMs only.
- Authored UI colors belong to `src/assets/styles/theme.js` as light/dark pairs,
  consumed as CSS variables. Follow the system color scheme, preserve portrait
  colors, and use `:active` plus `:focus-visible` instead of hover-specific styles.
- Preview fixtures retain English source keys; UI labels, accessibility text,
  sample messages and relative day labels render in the launcher's locale.
  Names and fixed clock labels remain fixture data. Do not apply sample-message
  translation to real user messages. Third-party messaging integration remains
  future work; keep app.js lean.

## Conversation preview and routing

- `ZILLION_FUTURE_FEATURES` controls the inert previews for home Search/New
  message, paid attention (header and menu), Attach, and
  Camera. Development enables them by default; `0` disables and `1` enables
  them. Restart the watcher after changing the flag. `bin/build-options.js`
  defines `FUTURE_FEATURES_ENABLED` and always forces it off in production.
  Self chat always omits both paid-attention controls, even with the flag enabled.
  Conditionally omit disabled controls from the DOM. The chat three-dot button
  occupies a single 44px circle without paid attention. Without the previews,
  the composer always displays Send, even when empty. Keep the profile button visible. Sending is implemented only in self chat.

- `src/components/router.js` owns `url-router`, `useLocation`, and `f-route`.
  `/` is home, `/contacts` is the alphabetical directory, `/contacts/add` opens
  identifier search with focus, `/chat/user` is real self chat, other
  `/chat/:contactId` routes are fixture DMs, and unknown routes/contacts
  render a localized unavailable state. No real contact lookup occurs.
- `z-route-page` scopes one `f-route` to its history entry using reactive
  `paths$`, so different contacts do not share a mounted chat instance. Keep
  `maxVisibleDistance` and the wrapper retention window at `MAX_ROUTE_DISTANCE`
  (4, matching Flame). Evict replaced entries, discarded forward history, older
  duplicates of the current pathname/query, and entries beyond four positions
  in either direction. Hash-only changes keep the same view. Eviction/reload
  discards local drafts and scroll; ordinary Back/Forward preserves them.
- Each page owns a `.route-scroll` container. Home's collapse hook reads that
  element, not window scroll. Cached pages keep their layout boxes and DOM
  state through `visibility: hidden`, `inert`, and `aria-hidden`; only the active
  page accepts interaction. Close chat menus and cancel pending long presses
  when a page becomes inactive. Do not use `display: none` for cached views,
  because their size observers and scroll state must remain stable.
  Descendants such as avatar images/loading placeholders must inherit visibility
  when shown; explicit `visibility: visible` can escape a hidden page ancestor.
- Mobile transitions (up to 718px) follow Flame's 150ms timing: incoming views
  move from +30% with opacity .55 when advancing, and outgoing views move to
  -100% when going back. Use Web Animations with `transform`, wait for lazy
  route content before starting, and cancel observers/animations on further
  navigation or breakpoint/motion-preference changes. Skip initial loads,
  replacements, hash-only changes, desktop and reduced motion. Keep toast
  outside the route deck. Do not import Flame's styling or old router code.
- Route retention requires thenameisf 1.2.10 or newer. Validate against the
  lockfile-managed dependency; do not ship sibling source imports.
- The primary user participates in the horizontal strip and active chat list
  as `You`, sorted by the locally stored profile name. `/chat/user` is self chat; group chats
  remain out of scope. Third-party previews reuse the home portraits without public keys.
- `?entry=1` makes a conversation the entry screen: show the inert Zillion logo
  instead of Back and expose no home link, including on unknown-contact states.
  This is a navigation presentation mode, not an identity/authorization contract.
  Ordinary home navigation marks `fromHome` in History state; Back uses the
  location store's `back`, or `replaceState` to home on an ordinary direct load.
  Directory navigation marks `fromContacts`, so chat Back restores the retained
  search/list rather than skipping it for home.
  Key the chat by contact and entry mode within its retained history page;
  replacing that page discards its drafts and timers.
- Chat fixtures live in `src/components/views/chat/fixtures`. Sample DMs share an
  exchange and end with their home preview; the former self-message fixture is retained only as sample/test reference.
  Quotes, reactions, timestamps, presence and link cards are static sample data.
  Do not fetch link previews for the sample screens; self chat reads runtime messages.
- The floating header is 48px plus top safe area, with 44px controls and equal
  2px vertical padding. Keep the chat column centered at `--z-mobile-width`.
  The composer follows the visual viewport when the mobile keyboard opens.
- Message actions appear on a 500ms touch hold, right-click, or Shift+F10.
  Cancel the hold on movement over 10px, cancellation, scrolling or unmount.
  Incoming actions sit to the right, outgoing to the left; Floating UI flips
  and shifts them near viewport edges. Keep Reply/Share-or-Copy/Delete vertically
  ordered above neighboring bubbles with a subtle surface and shadow.
- `useAnchoredMenu` owns Floating UI's public positioning API and observers.
  The installed thenameisf does not export its internal floating hook; do not
  bypass package exports. `url-router` and `@floating-ui/dom` are direct runtime
  dependencies for route matching and the two anchored menus respectively.
- `share-text.js` shares only the selected rendered message (including its URL).
  A native AbortError is cancellation, never implicit copying. Other native
  failures fall back to `copy-text.js`, which tries Clipboard then legacy copy
  and restores focus/selection. Show an icon-only green check for 1600ms after
  successful copy; failures use the reactive toast. Clean up pending UI work.
- The header menu, Delete actions, attention and camera are presentation only.
  Reply, Send and Attach work in self chat; its paperclip stays available while
  typing, independently of future-feature previews. Other chats retain the
  fixture controls: typing hides Attach and swaps Camera for Send. Preserve
  Enter/newlines, grow to five text lines, then scroll inside the textarea; align
  icons to the bottom line. Drafts are local component state. Send synchronously
  accepts a self-chat message into the service outbox, clears the draft/reply,
  and leaves the composer ready for another message. Rejection before acceptance
  keeps the draft and shows a toast; asynchronous write failures belong to the
  accepted bubble. Keep all added labels and fixture texts translated in 11 locales.
- The composer task synchronizes `textarea.value` from the draft signal before
  measuring its height. Do not also bind `.value` in the template: reactive task
  reruns can precede template commits and measure stale text after sending.
  Clearing an accepted draft resets height and internal scrolling without another
  input event; later write completion/failure never changes the current draft.

## Structure and imports

Use the `package.json` aliases copied from nappstore:

| Alias | Destination / responsibility |
| --- | --- |
| `#f`, `#f/*` | `thenameisf` and its public subpaths |
| `#bin/*` | `bin/`: development and build tools |
| `#lib/*` | `lib/`: supporting modules with no UI dependency |
| `#*` | `src/*`: application code |
| `#assets/*` | `src/assets/`: HTML, styles, and media |
| `#config/*` | `src/config/`: public client configuration |
| `#helpers/*` | `src/helpers/`: functions shared across consumers |
| `#services/*` | `src/services/`: shared integrations and state |
| `#hooks/*` | `src/components/hooks/`: shared UI hooks |
| `#shared/*` | `src/components/shared/`: reusable components |
| `#views/*` | `src/components/views/`: screens |

A consumer may have its own `helpers/` and `services/` folders for code used
only by that consumer. Promote code to shared folders when there are actual
consumers; the rule to evaluate libp2r2p first still applies. Create modules as
needed; empty folders mark the initial structure.

## Nsite and publishing

- Deliver static files for browser execution. Do not depend on a Node.js
  backend at runtime or service workers, including push/background sync that
  requires them. The build and local server are development tools.
- Follow [NIP-5A, Named Sites](https://github.com/nostr-protocol/nips/blob/master/5A.md#named-sites):
  a `kind: 35128` manifest with a `d` tag. For canonical URLs, the identifier
  has 1–13 characters in `[a-z0-9-]` and does not end in a hyphen; `zillion`
  meets this rule.
- `napp.jsonc` is the metadata source. The build generates
  `dist/zillion/.well-known/napp.json`; nappup consumes it and removes it from
  the list of published files. Do not treat it as runtime configuration.
- Consult `../../nappup/README.md` and the uploader code when changing publishing.
  Document ecosystem customizations separately from NIP requirements.
- Publishing uses the sibling nappup checkout through npm link. Zillion has no
  registry nappup dependency. Run `npm run link:nappup` after initial installation,
  switching Node/npm, or `npm ci`; it registers `../../nappup` globally for the active
  installation and restores the local link with `--no-save --package-lock=false`.
  Install the sibling's dependencies first. Keep links out of the lockfile.
  Restart active watchers after linking. Do not manually edit node_modules.
- The link shares code, not publisher credentials. `DOTENV_CONFIG_PATH` selects a
  shared encrypted dotenv file independently of the app directory. This workspace
  uses `$HOME/repositories/napps/.env` through the Bash startup configuration.
  Ensure publishers inherit that path and restart existing watchers after
  changing it. Isolated tests must explicitly use
  their own temporary dotenv paths. Preserve the
  user's chosen identity and existing files; do not migrate or rotate secrets
  implicitly when changing dependencies. Never log secret values.
- `npm run start:publish` publishes
  successful builds to draft after a two-second debounce; `upload:draft` performs
  one upload. Both use identifier `zillion` and share a project upload lock.
  The main channel is published only by an explicit `npm run upload`.
- Preserve immutable build bytes while nappup reads them. Temporary directories
  isolate uploads without changing published filenames. Build errors invalidate
  pending publication; only the latest pending successful build is retained.
- A stale upload lock fails explicitly instead of being reclaimed concurrently.
  Check that its uploader has stopped before removing `tmp/upload.lock`.
- Let nappup manage publisher authentication and its existing environment file.
  Never put credentials in assets, public configuration, bundles or diagnostics.

## Conventions and validation

- Follow `eslint.config.js`: JavaScript, single quotes, no semicolons,
  kebab-case filenames, and Node.js imports with the `node:` prefix.
- Justify new dependencies with a concrete need. Initial runtime dependencies:
  `thenameisf` for UI, `libp2r2p` for Nostr/messaging/storage, and DiceBear
  core/styles for the copied avatar fallback. Build, lint, and upload
  tools belong in `devDependencies`; do not copy dependencies for app store
  features without a need.
- Use `npm start` for development, `npm run build` for `dist/zillion/`, and
  `npm run serve` to inspect the result at `http://localhost:4000`.
- Run `npm run lint` and `npm run build` when changing code/configuration that
  affects those workflows. Validate behavior with tests proportional to the
  change; `test` and `test:only` target `tests/**/*.test.js`. Without test files,
  an empty run does not demonstrate behavior.
- Do not edit `dist/` or `node_modules/`. Update `package-lock.json` when changing
  dependencies. Report what was validated and any limitations.

## Runtime development and browser tests

- The workspace root is `repositories/`; Zillion lives at `napps/zillion`.
  Related repositories (`44billion`, `ez-vault`, `nappup`, `libp2r2p`) are two
  levels above the app root. Resolve tooling imports relative to their source
  files: three levels from `bin/`, four from `tests/browser/`.

- `npm run start:adb` adds the shared `../../44billion/bin/adb-session.js` handle to
  the local development watcher; `start:publish:adb` uses real publication. It forwards ports 10000/4000 and streams phone
  Chrome/Edge logs; it must not duplicate the build, upload queue, or supervisor.
  Validate ADB/device availability before starting the watcher.
  Honor `ANDROID_SERIAL`, preserve existing mappings, and close owned mappings
  on shutdown/failure. Phone storage is separate from desktop/test profiles;
  report when physical-device verification is unavailable.
- `npm start` starts or reuses the sibling launcher's development supervisor.
  Ports 10000 (launcher), 8080 (esbuild), and 4000 (existing vault origin) are fixed.
  Never kill unrelated servers or silently choose another port. Stop only owned
  processes. The supervisor also serves the vault's `.dev` files through the
  launcher vault route; production continues to serve `docs`.
- After an app feature, run the relevant checks and confirm publication of its
  local build through the watcher and real browser. Validate actual draft
  publication through `start:publish` or `upload:draft` when changing publishing.
  Report upload failures separately from validation failures. Do not publish main
  as part of routine development.
- Keep fast logic tests in `tests/**/*.test.js`. `test:browser` runs separate
  `tests/browser/*.browser.js` files with Node and Chrome/CDP. No in-source test
  runner or test API is shipped with the app.
- Browser tests use the full local launcher, its injected APIs, the real vault,
  and real permission dialogs. Prepare app files/manifests through the launcher's
  test installation helper, not a copied database schema in Zillion. Sibling
  imports are allowed in development/test tooling, never in production bundles.
- Use disposable Chrome profiles and generated test identities. Block external
  traffic; control media/probe responses at the network boundary. Import test
  keys through the vault UI when signing is required; do not replace the signer,
  event store or permission providers. Fixtures that mount UI follow the
  thenameisf skill and are compiled only into the local test installation.
- Ordinary reload scenarios retain one unpublished app version; local-update
  scenarios explicitly register the next build. Write through real APIs and
  assert recovery without restoring data. Published draft updates still clear
  runtime data. No snapshot API is introduced; the Node coordinator survives
  iframe reloads.
- Optional arbitrary test state uses `CUSTOM_APP_DATA` (kind 30078) from
  `libp2r2p/kind`, JSON content, and `d = zillion:test:<runId>:<instanceKey>`.
  Reuse the coordinate within the scenario, use increasing `created_at`, and set
  NIP-40 expiration to 24 hours. The launcher already purges expired events;
  remove the browser profile on teardown as the primary cleanup.
- Save failure diagnostics/screenshots to `tmp/browser-failures/` before teardown.
  Keep automated browser tests independent from real draft publication. Validate
  actual publishing and automatic draft updates separately when changing that
  workflow. Review README and AGENTS together whenever it changes.

## Local app installation

- `npm start` uses the 44billion local-app publisher with a 250 ms debounce;
  `start:publish` retains the two-second remote draft watcher. Both reuse the
  existing supervisor, build options and immutable queue. No uploader credentials
  are required for the local path. Keep tests/fixtures out of regular builds.
- Preserve `tmp/local-dev/identity.json` across runs. Never substitute the real
  publisher's key. Report malformed identity files instead of silently rotating.
- Local control uses development-only routes on localhost:10000 and the supervisor
  token file in the launcher checkout. Never log tokens or include them in URLs.
- Browser installation uses the launcher's writers, installs files before the
  manifest, and preserves data/routes during reload. The launcher owns local
  classification, remote-update exclusion, version leases, budgets and cleanup.
- The explicit menu reset affects only the selected user/app. It must pause other
  instances, await completion and report partial failures. Remote draft cleanup
  continues unchanged. Run the local-update browser scenario when changing this.
- The launcher also exposes a development-only full environment reset above that
  action: it wipes the vault accounts, every app origin and the launcher origin.
  Keep Zillion out of that protocol; it only needs to survive a fresh launcher
  boot and be reinstalled from the printed local link.


## Real self chat

- `useInitAccount` runs once in `z-app`, calls `peekPublicKey` early and owns
  profile/history subscriptions. `useAccount` readers do not start subscriptions.
  Its internal `recover()` coalesces identity/history recovery across the clip,
  gallery Retry and conversation Retry. Never recreate a same-account service
  just to retry reads: that would discard its outbox and prepared attachments.
  Replace subscriptions with generation guards, including after decryption;
  account teardown/change closes the old service and suppresses late results.
  `historyState$` distinguishes loading/loaded/unavailable. `historyLoaded$`
  becomes true only after initial query processing and stays true during
  same-account recovery, so scroll initialization does not restart.
  `/chat/user` never falls back to fixture messages, including when signed out.
- `src/services/self-chat.js` uses unsigned kind-9 text templates and unsigned
  kind-1063 file templates, explicit context `dm:<own hex pubkey>`,
  `addPersonalCopy` and query/subscribe. No relay sends or private-messenger
  transport are involved. Only owner-authored direct/signed copies in that
  exact context are rendered; hearsay/other authors are excluded. The feed
  subscribes to inner kind 9 only; file metadata is resolved through the
  references of those messages instead of becoming a bubble.
- Every new message is kind 9. An attachment writes its kind 1063 first and
  then the kind 9 that references it, so the file row exists before the message
  row commits. The kind-9 `.content` holds NIP-21 `nostr:nevent1…` URIs (kind and
  author, no relay hints) followed by any literal text; the text typed for an
  attachment lives only in the kind-1063 caption. Replies prepend the replied
  event's URI and carry a `q` tag for each referenced event in the same order;
  a reply with an image therefore carries two `q` tags and two URIs. Consume
  `q` tags and content URIs together, deduplicated by id, with a URI keeping its
  content position and a `q`-only reference rendering before the text.
- `src/services/chat-references.js` resolves those references lazily from the
  local store: pending outbox events first, personal copies through
  `signer.obfuscate(id, '1006', '.id')` plus a `#o`/`#c`/`#v`/`#k` query, then
  public events by `ids`. Results are cached in memory and cleared on account
  change/teardown. Only kinds 9 and 1063 (and unknown `note1` pointers, which
  must be looked up to learn their kind) are resolved; every other kind keeps
  the existing inline label/link presentation. Never fetch references over the
  network and never query relays for them.
- The launcher owns wrapper encryption/signing. Read kind-1006 wrappers with
  obfuscated `c` and inner `k=9` or `k=1063`; decrypt through the documented
  NIP-44 v3 signer extension's `ArrayBuffer` result directly with `TextDecoder`;
  never Base64 decode the injected v3 API result. The local launcher/vault
  channel also stays binary; remote bunker and encrypted-log encoding belong to
  the vault. This requires the companion launcher/vault binary API update.
  Compute inner IDs with the library event hash; q tags and URIs use those IDs,
  empty relay hints and the owner pubkey. A `salt` tag on both the kind 9 and
  its kind 1063 distinguishes identical intentional sends. `getRandomId` in
  `src/helpers/random-id.js` encodes 12 bytes from `crypto.getRandomValues` as
  16 Base64URL characters through libp2r2p. Retries retain the same templates
  and salts until saved.
- Render messages oldest first by ascending `created_at`, then descending
  lexical inner ID (the reverse of NIP-01's initial newest-first query order).
  Before accepting a send, vary only the kind-9 salt until its ID is lower than
  the newest known message in the same second. Limit this search to 128 hashes
  or a 4 ms elapsed budget, checked between hashes. On exhaustion, advance the
  effective timestamp by one second without waiting. Start from the greater of
  wall time and the newest observed/accepted timestamp; pending and failed sends
  count, and deletion does not rewind this in-memory boundary. History and live
  copies seed it after restart. This coordinates known events in one service,
  not simultaneous offline sends on separate devices or instances.
  A timestamp advance rebuilds the 1063 and both its `q`/URI references before
  accepting the kind 9 into the outbox. Kind-1063 salts stay random; only kind-9
  inner IDs are searched, never launcher-owned kind-1006 wrapper IDs. Once
  accepted, timestamps, salts, IDs, replies and file references stay fixed on Retry.
- Bubble references follow the plan: a resolved kind 9 renders as
  `z-chat-quote`, a resolved kind 1063 as `z-chat-attachment` in the URI's
  position, unresolved or unsupported kinds stay compact inline references,
  and quotes never nest. `q`-only references that do not resolve to a chat
  message add nothing, exactly as before.
- The line break that separates an expanded block (quote or attachment) from
  the surrounding content is structural, not a blank line the author typed.
  `augmentedContentItems` consumes the first whitespace run after such a block
  — space, tab, line break or a mix — so `URI URI`, `URI\nURI` and `URI\ntext`
  render flush and the next line never starts indented. Extra line breaks
  survive, so an authored `\n\n` still keeps one visible blank line. Unresolved
  references stay inline and keep their separator; never rewrite the stored
  event content.
- The self-chat service owns an in-memory outbox and message `status` values
  `pending`, `error`, and `saved`; never serialize UI state into a Nostr event.
  Concurrent sends have independent entries. Explicit retries reuse the same
  unsigned template, ID, timestamp and reply, and coalesce in-flight attempts.
  Either an acknowledged successful write or a verified live copy confirms the
  message; a late failure cannot regress that confirmation or duplicate a bubble.
  Retained routes and same-account history recovery share the outbox, but reload/root teardown/account change
  discards unpersisted entries. This is not a durable offline send queue.
- Real bubbles use `z-chat-message-status`: use 14px-wide icons at the
  current metadata height for the static Tabler clock and red alert-circle.
  Saved messages show only the time at its natural width. Visible expansion
  animates width for 150ms/ease-out through Web Animations; contraction is
  immediate. Observe intrinsic content, release animation styles, and cancel
  on viewport/keyboard changes, reduced motion, inactive routes and unmount.
  Initial history does not animate. Width changes that wrap metadata onto a
  new line use the existing height animation without cancelling it on every
  width-only ResizeObserver notification. During width interpolation, a short
  rAF loop prepares height before observer delivery and temporarily holds the
  outer height, avoiding invalidation of already-observed ancestors at a wrap
  boundary. Clicking the alert opens the existing
  message menu with a 22px regular `refresh-alert` icon in `--z-accent-text`,
  a standard 44px circular button and localized Retry label/title;
  status changes preserve DOM identity and icon-to-icon geometry.
- Keep subscriptions alive across retained route changes and cancel on root
  unmount. Initial replay requires this change's companion launcher update and
  is pending upstream deployment. Offline personal-copy signing also requires
  the companion ez-vault update for local content keys (nsec accounts). Deduplicate snapshot/live overlap by inner ID.
- Own public profiles come only from the event store; the launcher imports their
  relay updates. `a-avatar` supports static `localOnly` to suppress relay work
  for this identity. Third-party profile caches retain stale-while-revalidate.
- Compact outgoing content with public `libp2r2p/nip27.compactWhitespace`
  before building the unsigned event, hashing it or accepting it into the
  outbox. Retries reuse that compacted event. Use the default total limit of
  eight line breaks and threshold of three consecutive breaks collapsing to two.
  `chatTimeline` derives compact display text for historical and live messages;
  bubbles, copy/share, posted quotes and composer reply summaries consume it.
  The home preview compacts the latest event separately. Never rewrite existing
  stored events or change their IDs. Keep escaped templates and `pre-wrap` CSS
  so surviving formatting works and presentation policy can change later; no
  original-text toggle is provided. Do not compact draft text while typing.
- Use public
  `libp2r2p/nip27.extractMedia` for links/media/references; images reuse the cache,
  videos render after connectivity confirmation, and unavailable media remains
  a link. Real messages share fixture bubble spacing and time/status metadata;
  separate localized calendar-day rows group the timeline. Preserve the
  compacted whitespace without adding template indentation into inline content.
  `parseChatContent` delegates reference extraction to libp2r2p 0.10.17 or newer,
  including HTTPS URLs with literal `+` in their paths.
  Its only adaptations are the MIME callback and converting njump event URLs
  into event references for provenance checks. Do not concatenate event pointers
  with app entities or implement a separate reference matcher in Zillion.
  App items render as accent-colored compact links to `https://44billion.net/`,
  opening in a new tab with `noopener noreferrer` and full original tooltips and
  accessible names. `appReferenceUrl` uses the public URL codec, preserving
  entities, channels and authors; only the root NIP-05 author `_@44billion.net`
  is omitted from named destinations when the bare alias decodes as a name.
  Bare names use that same default author.
  Reply summaries remain plain compact text. App references never enter the
  event-preview or reply-thumbnail lookup paths and cause no author/preview fetch.
- Real-message HTTPS links use bounded, credential-free CORS head reads for OG
  cards and declared icons, with /favicon.ico as fallback. Metadata has a bounded
  in-memory cache; image bytes reuse media-cache. Never mount fetched page HTML.
  CORS-denied sites keep a link and best-effort favicon; no proxy is configured.
  Fetch only visible references on active routes and cancel work on exit.
- Compact URL/NIP-19 display labels to 22 characters plus an ellipsis when needed;
  URLs omit the scheme/www and retain file extensions, while NIP-19 never gains
  a slash prefix. Preserve full destinations, tooltips and accessible link names.
  References use the accent color without underlines; copy/share keeps full text.
  Reply quotes and composer summaries reuse the same compact labels and full-text
  tooltips. Posted quotes show an ellipsized author line and one ellipsized excerpt
  line, with at most one 38px thumbnail matching their combined height. Start
  quoted-media work only near the viewport; sample quotes never fetch media.
  Composer summaries clamp to two lines beside
  a fixed 44px cancel button (24px icon-x), centering short text vertically. A
  single 44px image/video/website thumbnail aligns text to the top when available;
  reuse media-cache and bounded link-preview reads with the same Nostr privacy
  checks. Cancel pending thumbnail work when changing replies or leaving the route.
  Never clear a loaded thumbnail on unrelated message updates.
  Preview tasks track derived target/private-status values, not the raw message
  list or parsed object identity. Keep loaded content across unrelated updates
  and retained route changes; clear it on target/account changes or discovery of
  a private copy. Media tasks similarly track URL/type values. Browser regressions
  observe existing preview nodes throughout insertion and enrichment, not only
  their eventual restored state.
- Unsupported NIP-27 event references can use njump.me after checking local
  provenance. Known self-message IDs, kind-1006 wrappers and inner IDs with local
  personal copies never trigger external previews. Denied/unavailable provenance
  checks also retain the plain Nostr link. Explicit njump URLs pass through the
  same provenance check. Address pointers conservatively stay local if copies
  of the same author/kind exist, since there is no personal-copy address index. Missing/unreadable njump pages keep the
  original pointer label and nostr: destination. No new persistent app store exists.
- The attachment catalog uses context `''`, alongside future private contact/follow events.
  Reactions, paginated history and third-party messaging remain
  unimplemented. All user-facing status/error/reply labels cover 11 locales.


## Chat layout stability

- `useInitChatLayout` owns a conversation-scoped viewport controller. It keeps
  bottom-following intent across programmatic corrections and uses a visible
  message as a reading anchor when the user scrolls away. Native scroll anchoring
  is disabled while this controller owns compensation, preventing duplicate
  adjustments. All layout corrections run through ResizeObserver before paint.
- While following the bottom, align the content's end to the scroll pixel grid
  using less than one device pixel of leading padding on `.timeline-content`.
  Fractional line heights otherwise move unchanged bubble edges by nearly one
  pixel as messages are prepended, even when scrollHeight reports a zero gap.
  Freeze this adjustment while reading or inactive, and restore it on teardown.
  Browser regressions must measure both bubble edges and heights throughout
  text-only history replay at multiple device pixel ratios.
- Day separators live in groups keyed by calendar day, outside message
  components. Prepending history must preserve existing date DOM nodes.
- Account readiness and initial history completion are separate. Self chat calls
  `onInitialLoad` after processing the initial query. Initial growth never animates;
  it ends after history and first resource attempts near the viewport settle,
  or when the user navigates up the history. Recheck visibility after bottom
  corrections, and retain this state across Back/Forward. Inactive routes do
  not adjust scroll or animate.
- Message content has an intrinsic inner box and an animated outer box. After
  initial loading, visible enrichment changes animate height through Web Animations
  for 150ms/ease-out. Replacements start at the current animated height, and
  completion/cancellation releases animation styles. Observe only the intrinsic
  box. Viewport/keyboard changes and reduced motion never trigger growth animation.
- Direct media reserves validated NIP-27 URL `#dim` proportions immediately.
  Otherwise images decode and videos obtain metadata outside the layout before
  insertion. Decoded dimensions take precedence over URL hints. External videos remain
  online-only and are not byte-cached; local nfile videos use launcher storage. Preview metadata/icon/image still arrive
  independently; privacy checks remain ahead of external Nostr previews.
- Browser scroll regressions must sample the bottom throughout staged resource
  delivery and preserve a visible reading anchor during offscreen growth, in
  addition to checking final offsets and retained navigation.

## Self-chat attachments

- Preparation uses `media-preparation/` before hashing sequential 51,000-byte
  slices. `artifact.js` is asynchronous and compresses new media by default. Its
  finalized File must supply BOTH preview and IRFS hashing;
  never upload a thumbnail or the experimental DC-only JPEG reconstruction.
  The compact preparation cancel control precedes a separate live status.
- One shared queue serializes compression and local preview work. Read File slices or validated
  local nfile HEAD/ranges in bounded pieces; never materialize a whole local
  response on the main thread. Local previews have a cancellable 120s watchdog,
  separate from the 15s HTTP preview timeout.
- Images use a disposable Worker bundled by the `?worker` build plugin. PNG
  reduction retains two scanlines and target-sized accumulators, checks CRCs and
  limits ancillary/profile allocations. JPEG requests native 1/2/4/8 scaling.
  Other formats retain native decoder costs; a Worker does not cap codec memory.
  Video uses MediaBunny with a small CanvasSink, one canvas and a bounded source
  cache; native video is a compatibility fallback when WebCodecs is unavailable.
  Workers are allowed after verification in the launcher (including alpha merge).
- `attachment-previews.js` keeps at most 8 MiB/128 small compressed thumbnails in
  an in-memory FIFO, separate from HTTP/avatar caches. Share in-flight work;
  cancel it when its last consumer leaves. Each cache entry owns one stable URL;
  consumers acquire disposable leases, synchronously for cache hits. Revoke a
  retired entry's URL only after its last lease closes. Gallery renders must
  never restore a revoked URL from a cached signal or clear a valid same-media
  preview during unrelated updates. Reuse selected thumbnails in pending/confirmed bubbles, gallery and
  replies; do not reopen the original just to display the composer thumbnail.
  Local video players use preload=none and a reduced poster. After-render tasks
  own video src setup/cleanup so retained elements restore it after confirmation.
- The composer owns one raw preparation outside useStore until Send transfers it
  to the memory-only outbox. Selection/removal never writes events. Close the
  preparation and revoke temporary visual URLs on replacement/removal/unmount or
  confirmation. Cancel superseded work so old selections cannot update the draft.
- Query/decrypt personal copies for inner kinds 9 and 1063 with their respective
  scopes, retaining owner/context/provenance validation. A file message is always
  the 9+1063 pair: the message is the kind 9, and the kind 1063 carries the
  caption, URL, mime, root, dimensions and thumbhash with no `q` tag. Consume
  nip94 tags directly; copy/share includes caption+URL.
- The composer gallery queries only context `''` for kind-1063 copies: the
  wrapper's plaintext one-letter `k` tag is indexed, so `'#k': ['1063']` filters
  in the store and only matching wrappers reach decryption. The store does not
  index mime, so the image/video-with-dimensions, unique-by-root filters still
  run after decryption. Resolution by inner id keeps using the `#o` mirror in
  the conversation context. Never merge conversation references into the catalog.
  Confirmed message changes and reopening refresh the catalog without replacing
  mounted tiles with shimmers; a change during a read queues another read.
  On Send, after confirming local bytes, write the conversation's metadata and
  ensure an image/video copy exists in `''` before saving kind 9. Deduplicate by
  `r` using its `#o` mirror (`obfuscate(root, '1006', '#r')`), scoped to owner,
  context, inner kind and provenance. Serialize check/write by root within the
  service and with a same-origin Web Lock when available. Reuse keeps the first
  catalog entry and creates a fresh conversation 1063 with the chosen send timestamp,
  caption and salt. Failed writes keep the exact templates for Retry. Do not
  migrate conversation-only metadata or handle legacy shared file events.
- Deleting a message sends a **private deletion envelope** (a personal copy
  whose inner is kind 5) in `dm:<owner>` naming the kind-9 inner id and its direct
  attachment's 1063 id, with both `k` tags when applicable. Identify the direct
  attachment through an owner-authored kind-1063 content pointer also present in
  the message's `q` tags. Preserve quoted messages and pasted pointers. The
  catalog copy in `''` survives even when its inner ID matches the deleted file.
  The service keeps a `#k:['5']` subscription (narrowed by the
  obfuscated `#o` kind mirrors for 9 and 1063) to drop messages removed by other
  devices, applies the removal optimistically and restores the message if the
  write fails. Successful deletions invalidate local and resolved references and
  prevent in-flight lookups or history replays from restoring removed events.
- Use public irfs/nip94/nip19 APIs from the published `libp2r2p@^0.10.18`
  package range, with the resolved release recorded in the lockfile; do not restore the local tarball.
  Hash/previews at selection; batches of at most three chunk writes on Send;
  confirm local bytes before saving metadata. Retry keeps timestamp/event/ID and
  skips existing chunks. Do not delete partial chunks or add quotas/encryption.
- The confirmed attachment catalog is latest-first and unique by root. Only
  image/video metadata with verified dimensions qualifies; defer thumbnail loads.
  Keep photo-plus duotone first and file-download cards for unsupported previews.
  Until initial history decryption completes, partial results do not establish a
  catalog. Loading displays add-file plus three noninteractive shimmer tiles
  (static for reduced motion) in one row, preserving panel height through failure
  and retry. Each panel recovery keeps loading visible for at least two seconds
  after rendering; hold only presentation, not account/history completion. Closing
  or unmounting cancels the timer, and stale timers must never reopen the panel.
  Failure shows add-file plus refresh-alert/Retry,
  without explanatory text. A known empty catalog opens the native picker;
  a late empty result keeps the panel open with add-file only. Close/reopen retries
  unavailable history; completion never changes panel visibility. Cached tiles
  acquire before first paint; cold tiles retain visibility-gated preparation.
  Gallery cells reserve square geometry in the parent render. Keyed thumbnail
  components receive an immutable root plus the shared reactive metadata index;
  avoid intermediate item adapters that remount in stages and briefly remove
  entire rows/images when reconnecting. Keep index lookup O(1) per tile. Frame
  regressions must include multirow galleries from the first mounted frame,
  including frames where no thumbnail child has rendered yet.
- Local nfile rendering bypasses HTTP caches and connectivity gates. Keep geometry,
  ThumbHash placeholders, active-route cleanup and the existing growth controller.
  Downloads are precomputed native links from getFileDownloadUrl; never file-sized
  Blob downloads. Selection object URLs are temporary previews only.

- Native file download links target the document-owned hidden iframe from
  `file-download.js`; prepare the URL before the click. The attachment response
  initiates the browser download without navigating the chat or opening a popup.
  Keep the real Chrome download-manager test, worker restart and offline reload
  assertions in `tests/browser/attachment-scenarios.js`. Run the focused suite
  with `npm run test:browser:attachments`; see the validation report for coverage.

- Read download intent from nip94/nip27 as the strings '0'/'1'. A flagged image
  or video thumbnail (including reply/quote thumbnails) uses a native download
  link, with no play/fullscreen action or video controls. Gallery selection and
  outgoing metadata stay unchanged: do not emit/propagate the download tag yet.
- `useMediaDownload` strips presentation fragments before calling the launcher's
  nfile download API. Keep instance-bound streaming for local files; external
  links depend on the server's Content-Disposition. Never introduce Blob
  downloads to bypass cross-origin browser restrictions.

- Browser npm scripts use the launcher's `bin/run-browser-tests.js`: one Linux
  user-systemd group for Node, Chrome, build watchers and vault, capped at 3 GiB,
  no swap, 15-minute maximum and descendant cleanup. Stop an existing runtime
  before testing; run one suite at a time. Do not replace this with a V8-only
  heap limit or bypass the guard when investigating memory pressure.
  Keep each guarded invocation well below the cap: the attachments run skips the
  controlled gallery fixture (`ZILLION_SKIP_GALLERY_UI=1`) and reloads the app
  before the download fixtures, while `npm run test:browser:gallery-ui` covers
  that fixture in its own unit. A kernel OOM can make systemd fail to kill the
  control group, so the runner also detects leftover launcher/vault/esbuild
  processes on the runtime ports, removes them and fails the run when it had to.


## Attachment presentation

- `attachment-presentation.js` centralizes filenames, byte labels, file categories
  and attachment geometry. Use the explicit name, then `r`, `ox`, `x`, and finally
  the translated unnamed-file label; only the generic name is italic. Infer
  missing extensions using the direct `mime` dependency, falling back to `.bin`.
- Filename components ellipsize the basename against available width, retaining
  the extension and full accessible title. Replies without thumbnails prepend
  the filename to the caption in normal inline flow, separated only when the
  caption is nonempty. Explicit and wrapped caption lines restart at the left
  edge of the reply. Never put filename and caption in separate flex columns.
  The composer reply preview shows `caption || displayText`, never the raw
  compacted content: a caption-less file reply is just the filename, not its
  kind-9 content URI. Raw content stays only for reply-thumbnail candidates and
  for the text-reply tooltip.
  Render a fitted label as one text run (`name…pdf`), preserving graphemes;
  separate text-overflow and extension boxes leave a visible gap. Measure against
  the full name's stable layout box to avoid threshold oscillation. The full
  accessible name and download filename are unchanged.
  Disconnect filename size observers on unmount.
- Bytes use decimal units and the current reactive launcher locale, at most one
  decimal without trailing zero. Unknown/invalid sizes are not displayed.
- Composer previews share the gallery's four-column cell sizing and radius, with
  contained media, themed category fallback and an internal remove button. Stack
  the reply first, then the selected/preparing attachment, then the open gallery. The
  paperclip highlights only while its gallery is expanded. Bubble attachments
  retain file-download cards, 160px desired minimum/320px maximum constrained by
  available width, and 360px media-height maximum, with letterboxing when needed.
- A rendered kind-1063 caption is presentation, not message text. Show it below
  `.attachment-download` inside `.attachment-caption`: italic, muted, slightly
  smaller than a normal message, horizontally limited to the attachment card.
  Clamp it to two lines and let each click reveal two more; it only expands,
  stops at the end of the text, and must not open the bubble's action menu
  (stop propagation on pointerdown and click). Caption measurement must not
  interfere with the bubble growth controller.
- Set the nfile filename on outgoing attachments and derive a download-only URL
  for existing references needing a name/extension. Preserve root, relay/author
  hints and localOnly; never rewrite received events or use a SHA hash as a root.
  Limit the encoded name to 255 UTF-8 bytes by shortening its basename, without
  visual ellipses. The launcher API and streaming behavior remain unchanged.

- Preview memory experiments in `docs/media-memory-experiments.md` are research,
  not production decoder guarantees. The local `tmp/media-memory-lab` is ignored
  by Git; never import its incomplete codecs into app code. Preserve previews
  rather than imposing resolution cutoffs. The user now permits Workers that
  work inside 44billion; this supersedes the research's earlier no-Worker constraint.

- Follow-up research in `docs/media-memory-variants-and-plan.md` separates preview
  pixels from a future transformed upload File. The hardened PNG row reducer
  and MediaBunny preview path are now integrated; see
  `docs/media-preparation-validation.md`. MediaBunny alpha merging and its MP3
  extension can create Workers; do not assume the whole library is Worker-free.
  Streaming encoded output alone does not bound native codec memory. Compression
  is now enabled; see `docs/media-compression-validation.md`. Incomplete DC JPEG
  previews must never become compression input. Preserve reported platform gaps.


## Automatic attachment compression

- `createUploadArtifact` is async, returns `{ file, changed, reason, close }` and
  owns a disk-backed final File. `prepareAttachment(..., { compress: false })`
  disables transformation internally; the composer defaults to enabled. Do not
  recompress retries or catalog reuse. Derive all metadata/root/URL from final bytes.
- Resize the shorter display side (rotation/SAR applied): >=1080 ->1080,
  >=720 ->720, otherwise 480. Never upscale/crop; round only for the codec.
  Static opaque JPEG .7; alpha WebP .7; animation WebP .7 with full composited
  frames, original cadence/duration/loop. MP3 128 kbps mono/stereo; video
  MP4 AVC medium quality, AAC 128 kbps, two-second keyframes, original cadence.
  Video uses MediaBunny default alpha/HDR treatment. Do not silently drop tracks
  or downmix multichannel audio. Reopen and validate outputs before accepting.
- Bundle MediaBunny and official AAC/MP3 extensions locally, never CDN. Image
  Worker writes <=64KiB pieces with acknowledgment; MediaBunny StreamTarget uses
  bounded 1MiB chunks. Never use BufferTarget, whole PCM or a file-sized output
  array. Static native canvas encoding holds only a bounded output surface.
- PNG compression requests linear-sRGB reduction at upload resolution, separate
  from the 320px preview. Unsupported color profiles use bounded native color
  management or original fallback. Memory guards currently retain originals
  above 8 Mi output pixels, 16 Mi native-image pixels, 32 MiB native image input, or
  10,000 animation frames. These are compression safeguards, not upload quotas
  or preview cutoffs. JPEG baseline uses native scaled decoding.
- `temporary-output.js` owns `zillion-compression-v1/artifact-<uuid>` OPFS files.
  Acquire a Web Lock before creating each file; retain it through outbox/retry.
  Sweep abandoned files and Chrome swap siblings only when the owner's lock can
  be acquired. Never delete another tab's live artifact. Explicit close waits
  for pending writes/finalization and removes the file. Reload does not persist
  drafts/outbox. `maintenance.js` is initialized once by the root `useTask`:
  first scan two elapsed minutes after mount, deferred while hidden; later scans
  on visible return and every 30 minutes while visible. Route/account changes do
  not restart this lifetime. Never sweep from `createTemporaryOutput`.
- Sweep only existing compression directories and recognized artifact/swap names.
  A nonwaiting maintenance Web Lock serializes tabs; per-artifact locks protect
  live owners. Share only the in-flight scan, not its completed Promise. Missing
  directories are normal; missing APIs stop maintenance silently. Return deletion
  failure counts and the first error internally, without UI notifications.
- Failed scans retry after 10s, 1min, 5min, then 30min; visible returns cannot bypass
  backoff. Clear timers/listeners and abort between storage operations on root
  unmount. Use injected time for schedule tests; browser coverage also waits the
  real two minutes in the launcher without an account or upload.
- Any unsupported/failed/non-smaller attempt keeps the exact original; storage
  refusal also falls back. Explicit abort always cancels selection. Unavailable
  compression gets a translated info toast; no-benefit fallback stays quiet.
  Preserve caption/reply, disable Send while preparing, retain accessible cancel.
- Run compression matrix/memory tests sequentially with the existing 3 GiB
  runner, then self-chat integration in the real launcher. Report native memory
  costs, codec gaps and unavailable mobile/other-browser coverage separately.

- Self-chat integration keeps development feature flags but sets
  `sourceMaps: false` for its disposable installation. Installing unused multi-MiB maps via
  a CDP expression exceeded the 3 GiB test budget. Normal development keeps maps.

## Contacts visual preview

- `/contacts` shows the real self identity separately, then saved fixtures in
  locale-aware alphabetical order. Search matches names without accents and
  partial npub/nprofile/NIP-05 identifiers. Letter headings disappear in search.
- `/contacts/add` shares the directory search, with a focused input and empty
  guidance. `data-route-autofocus` lets page transitions focus its input instead
  of replacing that focus with the route scroll container. Exact identifiers match an unsaved fixture locally; public nip19
  decoders also match equivalent nprofile pointers with different relay hints.
  No contact persistence, relay lookup or NIP-05 verification occurs. Fixture
  identities and portraits live in `views/contacts/fixtures/people.json` and
  the existing home portrait bundle. `luna@example.com` opens the unsaved preview.
- Unsaved fixture DMs reuse `z-chat`, its floating header/menu, viewport handling
  and route retention. They show a profile and Add Contact invitation instead
  of messages/composer. The button explains that adding is unavailable; it does
  not mutate contact data. Saved fixture DMs keep their existing sample messages.
- Do not add bottom navigation. New labels cover all 11 supported locales, and
  the existing light/dark theme variables provide all authored colors.

## Profile preview and editor

- `/profile/:contactId` reads the existing account person or bundled contacts.
  `/profile/user/edit` is a separate local-draft form with Save and image controls
  disabled. Never publish kind 0, resolve third-party metadata or verify NIP-05
  as a side effect of these views. Native Share/Copy is functional.
- `profileDetails` normalizes presentation strings: trimmed `name`, then `display_name`,
  with an italic translated absent-name label in the view. Share the complete
  NIP-05 if present, otherwise npub; shortening is display-only. Missing owner
  identity disables sharing. Do not add verification badges. Profile metadata
  is independent of a fixture's local directory label. Real bios are not translated.
- The shared portrait uses existing avatar/media caches and an abortable banner
  task. Missing, invalid or failed covers keep the compact layout; loaded covers
  are 160px with a 96px avatar overlapping by 32px. Do not reserve missing covers.
  Fixture cover bytes are bundled, with no external dependencies.
- Contact/pin simulation belongs to each retained profile component, never the
  account/global store: removing clears pin, noncontacts cannot pin, and self
  cannot add/remove itself. Retained Back/Forward preserves simulation and edit
  drafts; eviction/reload discards them. Key self views by owner to prevent drafts
  or simulation leaking between accounts. Untouched edit fields follow incoming
  account metadata; touched fields preserve drafts without changing account data.
  The editor has one Name input using the same name fallback as the profile.
  Its drafts target `name` only, never `display_name`; an explicitly cleared draft
  stays empty instead of reapplying the metadata fallback.
- Home and chat avatars navigate with `fromHome`/`fromChat`; Edit uses
  `fromProfile`. Back restores the retained origin. Direct profile loads return
  home, direct editor loads return `/profile/user`. Keep the chat header geometry
  unchanged, with a 44px avatar target around its existing 36px picture.
- Bio expansion starts at two lines and adds two per activation, preserving
  whitespace and using normal text weight/style. Hide Show more when exhausted;
  remeasure on width changes and reset on text changes. Share follows the existing
  canShareText/shareText contract with a 1600ms copy check and translated error
  toast; cancellation never copies. Cancel banner work and feedback on teardown.
- `tests/browser/profile.browser.js` covers routing, retained chat drafts, local
  toggles, editing, share/copy/cancel/failure, bio expansion, themes and narrow
  screens in the guarded launcher/Chrome runtime. Test-only account/API controls
  are injected into that disposable build and never shipped.

- Profile identifier rows live in `views/profile/identifiers.js`, sharing a fixed
  icon/value/action grid. Use the Nostr/Lightning/Bitcoin theme color tokens and
  copy the complete value of the selected row; never reuse another row's check.
  Preserve NIP-05 and expose npub separately when both exist. Both use the user
  icon: NIP-05 uses the green accent-text token, npub uses the purple Nostr token.
- `profile-payments.js` maps `lud16`/`lud06` by syntax, without endpoint requests,
  and derives mainnet key-only Taproot addresses through the public scure API.
  Read [the protocol notes](docs/profile-payment-identifiers.md) before changing
  encoding or derivation; the NIP-BC source is a specific draft, not an adopted NIP.
  Lightning editing is a local raw draft plus mutually exclusive lud16/lud06
  draft fields. Invalid input cannot become a payment row. Bitcoin is read-only
  and never comes from kind-0 metadata. No payment or signing APIs are added.

## In-app media viewer

- `/chat/:contactId/media` and `/profile/:contactId/photo` are pathname routes;
  the fragment stores only the selected media ID, not routing. Opening pushes
  one history entry and changing selection replaces that fragment. Back/Close/
  Escape return to the retained origin; direct entry falls back to chat/profile.
- The viewer is the sole full-width route, with a neutral dark surround in both
  themes. It uses available app space and never requests browser fullscreen.
- `conversationMedia` extracts lightweight occurrences from loaded messages;
  its `urlsOnly` mode snapshots direct URLs once per active viewer session.
  Resolved 1063 references use `file:<inner-id>` routes and do not become extras.
  Quotes and download-only direct URLs stay excluded. Repeated sends remain
  distinct; duplicate URLs within a message are one occurrence. Profile photos
  remain isolated and use the avatar cache and deterministic fallback.
- `services/conversation-media.js` owns one reader per active conversation viewer.
  Query/count personal copies in `dm:<peer>` using the SAME exact MIME mirrors
  (`m` -> `o`), never the context-empty catalog. Orphan and download-only 1063s
  qualify. Validate decrypted inners as before; invalid/unreadable items keep a
  counted unavailable slot. No full reference sweep or account-cache population.
- Reader API: `open(id)`, `move(step)`, `refresh()`, `close()`, returning
  `{ current, previous, next, index, total }`. `index` is zero-based, -1 when
  unavailable. `onInvalidate` requests refresh after live additions/deletions;
  closing cancels subscriptions and discards caches, and ignores pending results.
  Changes preserve current ID, then prefer next/previous if it is deleted.
- Metadata pages contain three files, with at most 12 cached descriptors. Ties
  use ID-only queries in batches of 200 with `!ids`; retain at most three active
  timestamp groups, not visited history. This is proportional to the largest
  same-second groups, not a strict byte budget. Count older timestamps and rank
  within the group only at open/refresh; moves advance the known ordinal.
  Order by ascending timestamp, descending wrapper/message ID, then URL slot.
  Do not seek unloaded kind 9s to reconstruct exact message order.
- `helpers/viewer-media.js` centralizes exact MIME values/aliases supported by
  at least one modern browser; never vary the counted set by runtime codec tests.
  Decoder failure keeps the item, Retry and a native download when possible.
  Keep three fixed template keys (slots), never one key per visited file.
  Abort preparations, clear detached image/video sources and release preview
  leases when slots change or routes deactivate. Neighbor videos may acquire
  cached posters only; only the current video receives a playable source.
  Direct chat media also release sources while inactive, retaining dimensions
  so scroll position and drafts survive. This does not paginate chat messages.
- Horizontal/vertical swipes (50px threshold), arrow keys and visible buttons
  navigate without wrapping. Incoming animation follows the swipe axis and
  honors reduced motion. Preserve native video controls; an explicit expand
  button offers keyboard access. Inactive videos pause and release their src.
- The viewer loads original media, not attachment preview thumbnails. Local
  nostr.alt streams remain local; external images use the existing bounded
  cache. Cancel preparation on route exit and show retry for unavailable media.
- Tests: `tests/conversation-media.test.js` and the guarded
  `tests/browser/media-viewer.browser.js`, plus existing profile/attachment
  browser regressions. No separate media catalog is stored. Test drivers stay
  out of published builds.
