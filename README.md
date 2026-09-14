# Afterglow

Afterglow is a shared light board for two people. Open the same room link on two devices, draw with a finger, stylus, or mouse, and see the lights appear on both screens. Each light fades after one, two, or three seconds.

The idea came from the Lite-Brite communication scene in *Stranger Things* season 4: a board of colored lights becomes a way to interact across a distance. Afterglow brings that interaction to a web browser, with touch drawing and a few shared games.

**[Try Afterglow](https://litebrite.it/) · [Download a release](https://github.com/KenzoKai/litebrite/releases)**

## Using the app

1. Open the site and select **Invite someone**.
2. Share the room link and open it on a second device.
3. When both browsers connect, draw on the board or select a game.

The link is reusable. Opening it again creates a new session in the same room; it does not restore previous drawings or game positions. Each room accepts two participants. Extra tabs and devices can occupy those places; opening the room in another tab of the same browser transfers that browser's connection to the new tab.

Drawing supports six colors and three fade settings. In free drawing, pinch to zoom, use **Move** to pan, or select **Fit** to show the whole board. Keyboard users can move the drawing cursor with the arrow keys, light a peg with Space, draw with Shift + arrows, and clear with Escape.

## Games

| Mode | How it works |
| --- | --- |
| Chess | Two players take assigned sides. Select a piece, then a highlighted destination. Includes castling, en passant, promotion, checkmate, and draw detection. |
| Tic-tac-toe | Take turns placing X and O on a shared board. |
| Falling lights | A cooperative falling-block game. Both players control the same stack, clear rows, and contribute to the same score. Includes rotation, a landing preview, next piece, pause, and increasing speed. |

Games can also be played locally without a connected partner. During a game, the surrounding area remains drawable by both participants. Game pieces stay lit while these drawings fade. **Clear drawings** removes the surrounding strokes; **Clear game** or Escape ends the round. Switching apps, leaving, or losing the connection clears the current session's drawings and game state.

## How it works

The frontend is a React 19 and TypeScript application built with Vite. An HTML canvas renders the drawing grid, and a PHP endpoint relays updates between browsers over HTTPS. The server does not run the game rules or render the board.

### Drawing and screen sizes

Free drawing uses a shared 56 × 36 grid. Each browser scales it proportionally to its available space, so touch coordinates refer to the same cells on phones, tablets, and desktops. Zoom and pan affect only the local view. Canvas rendering accounts for device pixel density separately from input coordinates.

Around games, the canvas uses pegs spaced every 10 CSS pixels. A separate 1024 × 1024 coordinate system maps strokes around the central game rectangle. Each browser projects those coordinates onto its own grid, giving wider margins more drawable pegs while keeping the game controls separate. Drawings fit the corresponding margin on the other device, so their proportions can change when the two layouts differ.

Input samples are interpolated to fill gaps during a drag. Outgoing updates are batched into packets of up to 120 points, with at most eight packets per request. Each point retains its color and original fade deadline, including time spent waiting to be sent. This prevents delayed updates from restarting the fade.

### Rooms and transport

A room link contains a random room identifier and a 256-bit key in the URL fragment, the part after `#`. Fragments are available to browser JavaScript but are not included in HTTP requests. The browsers derive a room identifier for the relay and use the Web Crypto API to encrypt drawing and game updates with AES-GCM. Session identifiers and sequence numbers distinguish participants and reject repeated packets.

All updates pass through `relay.php`; there is no direct browser-to-browser connection or WebRTC dependency. Active browsers aim to poll every 100 milliseconds. Actual update timing depends on network and server response times.

The PHP relay uses a 2 MiB shared-memory segment and an empty lock file to coordinate workers. It supports up to 16 rooms, with two participants per room. Each recipient's queue is limited to 64 encrypted packets and 24 KB. Undelivered packets expire after 800 milliseconds and are removed on the next request. Inactive membership expires after 12 seconds. These bounds suit a small deployment; the relay is not designed to share state across multiple server machines.

### Game synchronization

One browser is selected to run the game rules and falling-block timer. The other sends numbered actions and retries until they are acknowledged. Updated game snapshots are sent through the same encrypted relay. Round identifiers keep delayed actions and drawings from appearing in a different game. Chess rules use [chess.js](https://github.com/jhlywa/chess.js).

### Data handling

The app has no accounts, database, analytics, application request logging, or saved drawing history. Drawings and game state live in browser memory; the relay briefly holds encrypted updates in shared memory. The app does not use cookies or browser storage to save sessions.

Room links can remain in browser history, bookmarks, or sharing apps. Anyone with the complete link can join an available place. The hosting provider still receives connection metadata and may keep infrastructure logs. Fading changes what is displayed; it does not prevent screenshots or recordings. Encryption relies on the browsers running the intended application code.

## Run locally

Requirements:

- Node.js 22.13 or newer; Node.js 24 is recommended and specified in `.nvmrc`.
- PHP 8.3 or newer with the `shmop` extension enabled.
- A current browser with Canvas, touch/pointer input, and Web Crypto support.

```sh
git clone https://github.com/KenzoKai/litebrite.git
cd litebrite
npm ci
```

Start the relay in one terminal:

```sh
php -S 127.0.0.1:5184 -t public
```

Start the frontend in another:

```sh
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/relay.php` to the PHP process. On systems that support it, `PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:5184 -t public` enables multiple development workers. The PHP development server prints request metadata to its terminal.

Web Crypto requires HTTPS or a localhost secure context. To test on a physical phone, use an HTTPS deployment; a plain HTTP address on your local network is insufficient.

## Build and host

```sh
npm run build
node scripts/verify-build.mjs dist
```

The `dist/` directory contains the compiled frontend, `relay.php`, and hosting headers. Serve its contents from an HTTPS website that executes PHP and supports shared memory across its PHP workers. No production Node.js process, database, or external signaling service is required. A static-only host, including GitHub Pages, cannot run the relay.

**Before deploying on your own domain:**

1. In `app/connection.ts`, change the production relay URL from `https://litebrite.it/relay.php` to your relay's HTTPS address.
2. In `public/relay.php`, replace the production entries in `$allowed` with your frontend's exact origins. Retain the localhost entries if you need local development.
3. If running multiple independent installations under one operating-system account, give each relay a distinct `MEMORY_KEY` and matching lock-file name.
4. Build again, upload the contents of `dist/`, and configure the host to apply the supplied headers. Apache-compatible hosts can use `.htaccess`; other servers need equivalent configuration.
5. Check that a GET request to your `relay.php` returns `{"transport":"https-memory","ready":true}`, then test the same room link in two browsers.

The downloadable web build is configured for the hosted app at **litebrite.it**. For an independent installation, use the source release and make the domain changes above before building. `npm run preview` previews the compiled frontend only; it does not execute PHP.

### Hostinger and GitHub deployment

The included GitHub Action builds pushes to `main` and writes the contents of `dist/` to the generated `codex/hostinger` branch. In Hostinger's PHP/HTML hosting panel, configure **Advanced → GIT** to deploy that branch into `public_html`. Wait for the GitHub build to finish before deploying. Hostinger auto-deployment is a separate setting.

Deploy the generated branch, not the uncompiled source branch. The workflow uses checksum-based copying and verifies that every asset referenced by `index.html` exists in the generated output.

## Checks

Build, lint, and focused tests:

```sh
npm run build
npm run lint
npm run test:geometry
node tests/game-frame-geometry.mjs
node tests/relay-crypto.mjs
node tests/relay-batching.mjs
node tests/games.mjs
node tests/games-crypto.mjs
```

With the local frontend and PHP relay running, install the browser test runtime and run the integration tests:

```sh
npx playwright install chromium
TEST_BASE_URL=http://localhost:5173/ node tests/live-smoke.mjs
TEST_BASE_URL=http://localhost:5173/ node tests/continuous-touch.mjs
TEST_BASE_URL=http://localhost:5173/ node tests/game-surround.mjs
TEST_BASE_URL=http://localhost:5173/ node tests/games-browser.mjs
```

Tests create their own rooms. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an existing Chromium installation, `RELAY_TEST_URL` selects a relay endpoint for backend tests, and `TEST_BASE_URL` selects the frontend. Browser screenshots are written to the ignored `outputs/` directory.

## Troubleshooting

- **Waiting for your person:** Both browsers need the complete, identical room link and access to the configured relay. Check its health response and allowed origins.
- **Room full:** Close or leave another tab or device using the room. An unresponsive participant's membership expires after 12 seconds without a poll.
- **Link loses its room information:** Some CDN browser-verification pages discard the URL fragment. Finish the verification, then reopen the original full link.
- **Blank page after deployment:** Confirm that the host serves the compiled `index.html` and that its referenced files exist under `assets/`. Run the build verification command above.
- **Devices behave differently after an update:** Reload both browsers so they run the same version.

## Project layout

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Main interface, room controls, and application state |
| `app/board.tsx` | Canvas rendering, input, and fading |
| `app/board-geometry.ts`, `app/game-frame-geometry.ts` | Coordinate mapping and stroke interpolation |
| `app/connection.ts` | Room lifecycle, encryption, batching, and polling |
| `app/games/` | Game rules, controls, and synchronization |
| `public/relay.php` | Shared-memory HTTPS relay |
| `tests/` | Geometry, transport, touch, and game checks |
| `.github/workflows/hostinger-static.yml` | Build and deployment-branch generation |

## License and inspiration

Released under the [MIT License](LICENSE). Third-party dependencies retain their own licenses; the vendored stylesheet's license is included in `vendor/`.

Afterglow is an independent project inspired by *Stranger Things* and the Lite-Brite toy. It is not affiliated with their creators or rights holders.
