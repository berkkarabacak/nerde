# Nerde App

Web app for Nerde.com — see [../README.md](../README.md) for the full project overview and documentation index.

## Develop

```bash
npm install
npm run seed     # first run only: categories + admin + curated demos
npm run dev      # http://localhost:7100 (Vite + API middleware in one process)
```

`npm run dev -- --port 8080 --host 0.0.0.0` forwards extra CLI args to Vite as usual.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Vite dev server with the whole API mounted (port 7100 default) |
| `npm test` | 77 Vitest tests (API, security, schema — isolated temp DBs) |
| `npm run build` | Type-check + production build → `dist/` |
| `npm start` | Production server (`server/serve.ts`): dist + API + /uploads, env `PORT` |
| `npm run seed` | Idempotent seed (18 categories, attribute schemas, admin, demo places) |
| `npm run import:osm` | Idempotent OpenStreetMap/Overpass importer (see ../DATA_SOURCES.md) |

## Notes

- Requires Node ≥ 22.18 (native TS type-stripping + `node:sqlite`); Node 24 recommended.
- `public/assets/maplibre-gl-*.mjs` are MapLibre v6's worker/shared chunks copied from
  `node_modules/maplibre-gl/dist/` — the bundled app loads them by exact URL; if you upgrade
  maplibre-gl, re-copy them (`cp node_modules/maplibre-gl/dist/maplibre-gl-{worker,shared}.mjs public/assets/`).
- Config via env, see `.env.example`. DB and uploads are local files (`db/`, `public/uploads/`).

## Static demo build (GitHub Pages)

```bash
npm run build:demo   # → dist-demo/ (base /nerde/, VITE_DEMO=1)
```

This produces a fully static, read-only build of the whole product for
https://berkkarabacak.github.io/nerde/ — no Node API required:

- `scripts/bake-static-api.ts` bakes `db/nerde.sqlite` into `demo-static/*.json`
  (categories, all published place summaries + attrs, per-category place details,
  a slug index). `scripts/build-demo.ts` then runs `vite build --mode demo`
  (`.env.demo` sets `VITE_DEMO=1`, base `/nerde/`, outDir `dist-demo/`), copies
  `index.html` → `404.html` (GitHub Pages SPA fallback) and
  `demo-static/` → `dist-demo/api-static/`.
- In demo mode `src/lib/demo.ts` (`demoApi`) answers every `api.ts` call
  client-side from the baked JSON — bbox/category/attribute/text filters,
  near-me, place detail and search all work on all baked data. Photos are
  served from `public/uploads/` (copied into the build by Vite).
- **What works:** browsing everything — map, clusters, categories, attribute
  filters, search, place pages, photos.
- **What doesn't:** accounts and contributions (login, signup, save, verify,
  comments, reports, photo upload, admin) — those endpoints answer
  `403 Disabled in this demo build`, the Login/Admin pages show an explanatory
  empty state, and a dismissible banner says the same.

### Deploy

Push the contents of `dist-demo/` to the `gh-pages` branch of the repo served
at `/nerde/` (e.g. `npx gh-pages -d dist-demo -b gh-pages`, or any CI equivalent).
`dist-demo/`, `demo-static/` and `verification/` are gitignored.
