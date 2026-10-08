# Shadow Clash — project notes

A 2D "street fighter" style fighting game: vanilla JS + HTML5 Canvas, bundled by
Vite. No backend, no database, no external services.

## Running in the Base44 sandbox

```
docker compose -f docker-compose.base44.yml up -d --build
```

- The `web` service runs `npm install && npm run dev` from the bind-mounted
  source on host port **3000** (Vite dev server, live reload).
- `node_modules` lives in an anonymous Docker volume; dependencies install on
  container start from `package.json`.
- `BASE44_PREVIEW_MODE`, `BASE44_PUBLIC_HOST_SUFFIX` and
  `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` are passed through from the platform
  environment so the preview proxy's host is accepted by Vite. No app code reads
  `BASE44_PREVIEW_MODE`; nothing is gated on it.

## Verifying it works

- `curl -s http://localhost:3000/` should return the HTML shell referencing
  `/src/main.js`.
- The served page is the live dev source (unhashed `/src/*.js` modules), not a
  production build, so edits reflect immediately.

## Layout

- `src/characters.js` — the 8 fighter definitions (stats + unique `special`).
- `src/game.js` — the engine: fixed-step combat loop, attacks, projectiles,
  per-character special abilities, CPU AI, canvas rendering.
- `src/main.js` — screens: character select menu, arena, result overlay,
  on-screen controls.
- `src/style.css` — UI styling.

## Controls

Player 1: `A`/`D` move, `W` jump, `S` block, `F` punch, `G` kick, `R` special.
Player 2: arrow keys + `J` punch, `K` kick, `L` special (ignored in vs-CPU mode).
