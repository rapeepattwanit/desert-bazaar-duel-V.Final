# Desert Bazaar Duel v5.0.0

A mobile-friendly 2-player online trading card game with WebSocket multiplayer, hidden bonus tokens, safer reconnects, responsive UI, and production-ready `public/` static assets.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Test

```bash
npm test
```

## Render

Recommended:

```txt
Build Command: npm ci --no-audit --no-fund
Start Command: npm start
Environment: NODE_VERSION = 22.x
```

Static files live in `public/`; `server.js` exposes only that directory.
