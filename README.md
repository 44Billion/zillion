# Zillion

A private chat inspired by WhatsApp and Signal, built as a Nostr client.
Messaging will use [`libp2r2p/private-messenger`](../libp2r2p/private-messenger/index.js),
which combines private messages (`private-message`) with transport over private
channels (`private-channel`). The entire front-end uses **thenameisf**.

The project is just getting started: this repository contains documentation,
tooling, a placeholder screen, and reusable avatar/cache foundations. Conversations, identity, and messaging
integration have yet to be implemented.

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

## Development

Requirements: Node.js 24+ and npm; Python 3 to serve the production build.

```sh
npm install
npm start        # development with automatic rebuilds; URL printed in the terminal
npm run lint
npm run build    # generates dist/zillion/
npm run serve    # serves the build at http://localhost:4000
```

`npm test` checks the offline cache and profile foundations.
The reusable avatar is not yet mounted in the placeholder screen.

The standalone development server does not provide the launcher's injected APIs.
The shared connectivity monitor currently lives in the sibling libp2r2p change;
use that local library for validation and update the npm version before shipping.
After `npm install`, link it without changing the manifest or lockfile:
`npm install --no-save --package-lock=false ../libp2r2p`.
Reinstalling from the lockfile restores the published dependency.

## Publishing

Zillion will be a static site published as an **nsite** (also called an app,
napp, or Nostr app), following [NIP-5A — Named Sites](https://github.com/nostr-protocol/nips/blob/master/5A.md#named-sites).
The project's runtime environment **does not support service workers**.

`npm run upload` builds the app and runs `nappup@latest ./dist/zillion/`.
This publishes to the network; publisher identity and upload options follow
[nappup](../nappup/README.md). The folder name sets the default identifier, `zillion`.

The build converts [`napp.jsonc`](napp.jsonc) to `.well-known/napp.json`, which
nappup consumes as metadata and excludes from published files. This format is
an ecosystem convention; document customizations separately from NIP-5A.

See [`AGENTS.md`](AGENTS.md) for architecture and contribution guidelines.
Keep both documents updated alongside the changes they describe. Write all
project documentation and code comments in English.
