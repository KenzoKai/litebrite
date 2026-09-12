# Afterglow

A standard **React + Vite** app: a two-person, ephemeral Lite-Brite communication board. Share a single-use invitation, draw with a mouse or touch screen, and watch every light disappear after 1–3 seconds.

## Run

Requires Node 22.13+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open the printed local URL. Internet access is required to pair browsers. The deployed site uses HTTPS; local development uses localhost. To use a phone, use the deployed HTTPS URL rather than an insecure LAN address.

## Deploy on Hostinger

In Hostinger’s **Deploy Web App → Import Git Repository** flow, select `KenzoKai/litebrite`, branch `main`, and these build settings:

| Setting | Value |
| --- | --- |
| Framework | **Vite** (React frontend) |
| Node.js | **24.x** |
| Root directory | Repository root (`.`) |
| Package manager | npm |
| Install command, if shown | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variables | None required |
| Application entry / start command | Not needed for the Vite frontend preset |

If an earlier import reported “Unsupported framework,” import or redeploy the current `main` commit and select Vite. The repository has a root `index.html`, `vite.config.ts`, and standard Vite package scripts. It no longer depends on Vinext, Next.js, Wrangler, or Cloudflare runtime bindings.

Hostinger serves the generated static files. No application backend, server process, database, or credentials are needed. HTTPS is required for invitation cryptography and reliable clipboard support. The signaling/relay services still require internet access.

For ordinary static hosting instead: run `npm ci && npm run build`, then upload the **contents of `dist/`** to `public_html`, including the `.htaccess` file. For Hostinger’s Node.js ZIP-import flow, upload the source project (root `package.json`, lockfile, and `index.html`), excluding `node_modules`, `.git`, and `outputs`.

Preview the built files locally with `npm run preview` (testing only, not a production server).

Official reference: [Hostinger deployment guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/).

## Behavior

- One host and one invited guest. A host can practice drawing before pairing; practice is cleared and never replayed to the guest.
- Invitations carry a random peer ID and 256-bit secret in the URL fragment. Fragments are not sent in HTTP requests and are removed from the guest's address bar on entry.
- The first guest proving possession of the secret is admitted. After pairing, both peers disconnect from the signaling service and the invitation cannot admit a third person.
- AES-GCM authenticates/encrypts all application messages with direction-specific peer IDs as additional authenticated data. WebRTC transport also encrypts data. Sequence numbers reject old/replayed messages within the connection.
- The board holds at most 2,016 pegs in RAM. Every peg expires within 1–3 seconds. Receiver-side expiry accounts for transit age using a handshake clock offset. Already expired packets are discarded.
- Blackout / Escape clears both boards. Visibility changes clear both boards and mark the participant away. Incoming strokes are discarded while the page is hidden. No history is sent on return.
- Invitation expiry: 10 minutes. Session expiry: one hour. Lost connections end the room; reconnect with a new invitation. A heartbeat detects silent connection loss.
- A viewport-sized workspace with visible 44px touch controls on portrait/landscape phones, tablets, and desktops; safe-area insets and dynamic viewport height accommodate mobile browser chrome.
- Shared 56×36 logical coordinates are mapped with uniform scaling and letterboxing, so drawing proportions are preserved across different aspect ratios. Device pixel ratio only controls raster sharpness and never affects transmitted coordinates. Existing clients remain wire-compatible.
- Local 1–4× zoom, two-finger pinch/pan, a Move tool, and Fit reset. Zooming and resizing preserve unexpired pegs without replaying or persisting strokes. Empty margins do not draw stray edge lines.
- Six colors, touch/pen/mouse input, accessible color/fade controls, native sharing where available, clipboard sharing with manual-copy fallback. Keyboard users can focus the board, move with arrows, and light pegs with Space; Shift+arrows draws a line.
- An event-driven canvas sleeps when no lights need repainting, follows display-density changes, and bounds the backing raster to eight million pixels.

## Privacy and limits

There is no application database, analytics, message logging, cookies, browser storage, or saved drawing history. Private keys are non-extractable CryptoKeys in memory. Ending a room releases references, but JavaScript cannot promise forensic RAM erasure. The recipient, browser, OS, clipboard, or sharing app may retain what is visible or explicitly copied/shared.

PeerJS Cloud performs signaling, Google provides STUN, and the PeerJS TURN service can relay encrypted traffic for networks needing relay traversal. They do not receive the invitation secret or plaintext strokes. The website host and third-party connection services may retain IP addresses and connection metadata; **zero infrastructure logging is not guaranteed**. Direct WebRTC may expose a participant's IP to the other participant. Availability and restrictive-network connectivity depend on those third-party services.

Fading reduces lingering content. It cannot prevent a short word from being read, screenshots, video, a malicious recipient, or a compromised device. This is an ephemeral drawing app, not an anonymity service or a certified secure messenger.

## Validation

```sh
npx tsc --noEmit
node tests/board-geometry.mjs
node tests/responsive-board.mjs
node tests/live-smoke.mjs
```

The live smoke test uses separate Chromium contexts, including a touch-enabled phone viewport, and real PeerJS signaling/WebRTC. It verifies pairing, transmission, complete fading, touch, blackout, Escape, third-person rejection, disconnect cleanup, empty browser storage, and responsive overflow. Set `TEST_BASE_URL` to an authorized local preview and optionally `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for a custom Chromium binary. Install Playwright Chromium with `npx playwright install chromium` if needed. Test screenshots are ignored in `outputs/`.

The privacy-safe optional WebMCP tool `blackout_board` clears the same board as the UI and never exposes strokes or invitation secrets.

## Hosting

The same `dist/` output also supports the existing Sites deployment via `.openai/hosting.json`. This file is only deployment metadata; Hostinger does not need it to build or run the app. `public/_headers` provides compatible static-host header rules; `public/.htaccess` provides equivalent rules for Apache/OpenLiteSpeed. The document itself declares a no-referrer policy. Verify host-specific HTTP header support in your hosting configuration. No OpenAI API key is required.
