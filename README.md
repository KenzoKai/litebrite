# Afterglow

A React + Vite light board for two people. Share a reusable room link, draw with a finger, pen, or mouse, and watch lights fade after 1–3 seconds.

## Connection and privacy

All current clients communicate through `https://litebrite.it/relay.php` using HTTPS. **There is no WebRTC, STUN, TURN, external signaling, or direct-connection fallback.** Participants receive random session identities, never each other's IP addresses. The server and hosting provider still see connection IPs and may retain infrastructure metadata; this is not an anonymity service.

The room link keeps a random 256-bit secret after `#room=`. The browser imports it as a non-extractable AES-GCM key. The relay receives a domain-separated SHA-256 capability hash, not the secret or original room ID. It sees only ciphertext and random client/session identifiers. Directional client IDs and a fresh pair-session ID are authenticated with each encrypted message. Both browsers verify an encrypted hello before showing Connected. Sequence numbers reject replays. A host that serves malicious JavaScript or a compromised browser is outside this protection.

There are no accounts, database, application request logs, analytics, cookies, local storage, or drawing history. The PHP relay holds at most 64 encrypted packets (24KB of ciphertext) per recipient in a bounded shared-memory segment. Undelivered ciphertext expires after 800ms and is removed on the next request; delivery consumes packets once. No ciphertext is written to application files. An empty lockfile coordinates PHP workers. The OS/provider can manage RAM and logs independently; forensic erasure and zero infrastructure logging are not guaranteed.

Session membership expires after 12 seconds without a poll. Leaving clears the queue and changes the pair session; a 15-second tombstone rejects late polls from the departed client. A new participant cannot receive an earlier pair's packets. The relay supports up to 16 simultaneous rooms, bounds request size and memory, and limits polling per member. If the relay fails or reaches capacity, clients clear the board and retry rather than exposing IPs through another transport.

Browser drawing packets carry at most 120 cells each, with up to eight packets per request. Pending cells retain their individual colors and original fade deadlines; overflow drains on subsequent requests and expired cells are discarded. Sample ages travel inside the encryption so batching does not restart a light’s lifetime. Foreground polls target 100ms between request starts, without an extra pause after a slow response. Hidden pages discard incoming drawings. Blackout, leaving, and connection failures clear transient state. Free drawing uses up to 2,016 fading pegs, never a saved transcript. Optional games keep their current board and chess rule state in browser RAM for the round; game lights do not fade. Switching games, Blackout/Clear game, hiding the page, disconnecting, or leaving removes that state. Games have no saved scores, move viewer, or resume history. Fading cannot prevent screenshots, screen recordings, or a recipient copying what is visible.

Room links remain reusable and may be saved in browser history, bookmarks, clipboard, or sharing apps. Anyone with the full link can occupy an available spot. Additional tabs/devices count as participants. Same-origin tabs coordinate without persistent storage. Create a different room for a new link; old links are not revoked.

**Both participants must reload after upgrading from the old peer-to-peer version.** Old pages cannot communicate with the relay-only version and continue running their previously loaded code until closed/reloaded.

## Local development

Requires Node 22.13+ (24 recommended), PHP 8.3+ with `shmop`, and Playwright Chromium for browser tests.

```sh
npm ci
# First terminal (development server emits request metadata to its terminal):
php -S 127.0.0.1:5184 -t public
# Second terminal:
npm run dev
```

Vite proxies `/relay.php` to the local PHP process. For multiple PHP workers on supported systems, set `PHP_CLI_SERVER_WORKERS=4` before starting PHP. The relay's application logging is disabled; production web-server/provider access logging must be managed separately. Use the deployed HTTPS site for phones; plain LAN HTTP cannot use WebCrypto.

## Hostinger deployment

Use the PHP/HTML website's **Advanced → GIT** deployment, repository `KenzoKai/litebrite`, branch **`codex/hostinger`**, destination **`public_html`**. The GitHub Action builds each push to `main` and updates the generated branch with `dist/`, including `relay.php` and `.htaccess`. Wait for the build to finish before redeploying in hPanel; auto-deployment is an independent Hostinger setting. Do not deploy uncompiled `main` directly into `public_html`.

`https://litebrite.it/relay.php` must execute PHP with shared memory available across workers. Its GET health response reports `{"transport":"https-memory","ready":true}`. A static host alone cannot run the relay. Static copies of the frontend at the permitted Hostinger/Sites origins use the same canonical relay endpoint and therefore share the same rooms. No TURN account, API key, database, or Node server is needed.

Hostinger's CDN browser-verification page was observed to discard the room fragment on fresh browser visits. If it appears, finish the check and reopen the original full room link. Do not put the secret into a query string to work around this: query strings reach servers and logs. CDN challenge filtering remains at its original Medium setting. Browser relay tests complete the normal homepage check before opening saved links; they do not validate that separate CDN first-visit behavior.

The relay only accepts browser origins explicitly listed in `public/relay.php`. When moving the canonical domain, update the endpoint in `app/connection.ts`, update that allowlist, deploy the relay, and retest. Do not enable direct connections as a fallback. Security headers are supplied in `.htaccess` and `_headers`; verify your host applies them. Browser URL fragments are never transmitted as part of HTTP URLs.

## Drawing controls

In free drawing, both screens share a 56×36 logical board with uniform scaling, independent of screen size or pixel density. Native touch events drive phone drawing; mouse/pen use pointer events. A brief second contact releases back into drawing when one finger remains. Pinch/pan, 1–4× zoom, Move, and Fit change only the local view. Six colors and 1/2/3-second fades are available. Keyboard controls: arrows, Space, Shift+arrows, and Escape for Blackout.

## Shared games

Choose a mode above the board: **Chess**, **Tic-tac-toe**, or **Falling lights**, a cooperative falling-block game. Without a connected partner, games work as local practice. With two updated browsers, selecting a game switches both boards. Chess and tic-tac-toe assign Amber / White / X and Sky / Black / O; the UI identifies your side. Chess includes legal destinations, castling, en passant, promotion choice, checkmate, and draw detection through [chess.js](https://github.com/jhlywa/chess.js). Either player can start a fresh round. A shared ring of fading pegs surrounds every game: draw with a finger, pen, or mouse in the top, bottom, left, and right margins. The surrounding canvas has uniformly spaced pegs every 10 CSS pixels, with the same radius on every side. A separate 1024×1024 coordinate space maps strokes proportionally around the protected game rectangle on different screens. Fine stroke samples are projected onto each screen’s peg grid; wide margins gain real drawing detail instead of stretching eight columns. Both browsers must reload to use this frame format. Drawing color and fade controls stay available. **Clear drawings** erases only the surrounding ink; **Clear game** or Escape ends the round. Ink packets carry the round identifier so old strokes cannot appear in a new game or the free-drawing board. Falling lights uses one shared stack and score with a seven-piece bag, row clearing, ghost landing preview, next piece, increasing gravity, touch buttons, and keyboard controls.

One browser, elected by the pair's random client identifiers, owns the rules and gravity. Encrypted snapshots of the current board replace older snapshots; the other browser retries numbered commands until acknowledged. Duplicates and stale moves are ignored. Game snapshots fit the existing relay limits and expire in the same 800ms server window. A generation counter carried by clears, game messages, and hellos prevents delayed snapshots from restoring a cleared game, even when a clear packet is lost. Gameplay cannot survive either browser leaving or a broken connection. No direct networking, server game storage, or logging is added. Both participants must reload after the update; older clients can still draw but cannot join games.

## Validation

```sh
npm run build
npm run lint
npm run test:geometry
node tests/relay-api.mjs
node tests/relay-crypto.mjs
node tests/relay-batching.mjs
node tests/relay-pacing.mjs
node tests/games.mjs
node tests/games-crypto.mjs
node tests/game-frame-geometry.mjs
TEST_BASE_URL=http://localhost:5173/ node tests/game-surround.mjs
TEST_BASE_URL=http://localhost:5173/ node tests/games-browser.mjs
node tests/continuous-strokes.mjs
TEST_BASE_URL=http://localhost:5173/ node tests/continuous-touch.mjs
TEST_BASE_URL=http://localhost:5173/ node tests/touch-recovery.mjs
TEST_BASE_URL=http://localhost:5173/ node tests/live-smoke.mjs
```

`RELAY_TEST_URL` overrides the PHP endpoint for relay tests. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects a Chromium binary; otherwise install it with `npx playwright install chromium`. Tests create isolated, random rooms and do not use existing user rooms. The sustained-touch test forbids WebRTC and WebSocket construction and verifies two-way drawing and expiry through the relay. `TEST_RELAY_LATENCY_MS=150` adds delay to each browser relay request; `TEST_FADE_SECONDS=2` selects a longer fade for slower-network tests. A one-second fade can expire in transit on very slow connections. The backend test checks burst buffering, admission, identity binding, one-time delivery, packet expiry, and stale-session isolation. Screenshots in `outputs/` are ignored.

The optional WebMCP tool `blackout_board` clears the board and never exposes drawings or invitation secrets.
