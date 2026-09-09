# Zillion

A Nostr client for private chat inspired by WhatsApp and Signal. The project
is in its initial phase: a fixture-backed home layout, avatar/cache foundations,
and build/publishing tooling exist. Do not describe planned features as already implemented.

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
  launcher change adds `window.napp.getWindowNappEventStoreFor(pubkey)` with the
  same store API for a persona member. Until that addition is committed and
  available in the target launcher, treat it as a pending runtime dependency and
  check availability before using it; remove this note once verified upstream.
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
  Records contain `{ url, dataUrl }`; the logical budget is 64 MiB with FIFO
  eviction and a 4 MiB download limit per image before base64 encoding.
  Cache hits remain usable offline until evicted or explicitly cleared; there
  is no freshness/TTL policy yet. Do not put message history in this cache.
- `a-avatar` starts from nappstore's component. Preserve its public props,
  image lifecycle, and deterministic DiceBear fallback while improving it.
  Zillion replaces its default LRU with event-store profile reads and IndexedDB
  image bytes. Optional `profileCache` remains a synchronous get/set/remove
  adapter; fallback memory is only for the mounted avatar, not durable storage.
- Resolve cached images before HTTP. Fetch readable image bytes with CORS,
  omitted credentials, bounded sizes/timeouts, and cancellation. A server may
  allow an online `<img>` while denying CORS downloads; do not promise offline
  persistence for that case. Storage denial/quota must not break the UI.
- For future message attachments, show a link when image bytes are unavailable
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

## Home layout preview

- Home currently renders fixed JSON from `src/components/views/home/fixtures/`.
  This visual preview deliberately ships sample data and local portraits. It is
  separate from browser-test fixtures, which remain excluded from publication.
- Do not fetch real identity, contacts, or messages for this preview. `a-avatar`
  receives provided data-URL profiles without public keys, so no Nostr lookup is
  triggered. Search, compose, profile, contact, More, and conversation controls
  are intentionally inert until interaction work is requested.
- Keep the main column at a maximum of 718px, centered with vertical borders on
  wider screens. Use the same mobile composition at every width. The contact
  strip fits whole items while keeping 44px portraits and a persistent More cell.
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
- Mount contact avatars only near the horizontal viewport. The installed
  thenameisf visibility task creates an observer without calling `observe()`;
  until fixed upstream, use an IntersectionObserver inside a normal `useTask`,
  rooted at the contact scroller with a short preloading margin and cleanup.
  Preview portrait bytes remain bundled data URLs; this defers avatar mounting
  and image decoding, not downloading those fixture bytes.
- The upper-right profile portrait matches the 26px action icons; the upper-left
  logo bubble starts at 42px. Inbox rows are DMs only.
- Authored UI colors belong to `src/assets/styles/theme.js` as light/dark pairs,
  consumed as CSS variables. Follow the system color scheme, preserve portrait
  colors, and use `:active` plus `:focus-visible` instead of hover-specific styles.
- Preview labels/messages are fixed English fixtures. Runtime locale, identity,
  and router integration remain separate implementation work; keep app.js lean.

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
