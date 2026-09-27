# Nerde.com — MVP

**Find your niche.** Nerde is a map-first platform for discovering highly specific categories of physical places — calisthenics parks, arm-wrestling clubs, vanlife spots, public showers, drinking-water fountains, viewpoints and more — the places conventional maps categorize poorly. Community-editable, seeded from OpenStreetMap.

> The product IS the homepage: choose a category → explore the map → inspect a place → contribute.

This repository contains the working MVP plus the full design/engineering documentation produced by the agent swarm that built it (see `MASTER_PROMPT.md` for the original brief).

## What's inside

| Path | What |
|---|---|
| `app/` | The web app (React 19 + Vite + Tailwind + shadcn/ui frontend; Node API + `node:sqlite` backend) |
| `MASTER_PROMPT.md` | Original product/engineering brief |
| `CONTRACTS.md` | Shared decisions + amendments (single source of truth for the swarm) |
| `PRODUCT_SPEC.md` / `MVP_BACKLOG.md` | Scope, acceptance criteria, prioritized backlog (P0/P1/P2) |
| `ARCHITECTURE.md` / `DATABASE.md` | System design, schema, geo queries, PostGIS/SSR upgrade paths |
| `DESIGN_SYSTEM.md` | Wireframes, palette, components, microcopy |
| `DATA_SOURCES.md` | OSM tag research (wiki-verified), ODbL licensing, import pipeline spec |
| `SEO_STRATEGY.md` | URL architecture, SPA rendering honesty + prerender/SSR escape hatches, JSON-LD |
| `TEST_PLAN.md` / `CRITICAL_REVIEW.md` | QA strategy (77 automated tests) and the adversarial launch review |

## Quick start (local development)

Requires **Node ≥ 22.18** (24 recommended — the server uses native TS type-stripping and the built-in `node:sqlite`).

```bash
cd app
npm install
npm run seed     # 18 categories + attribute schemas + admin user + curated demo places
npm run dev      # http://localhost:7100 — Vite dev server with the API mounted as middleware
```

Optional — import real OpenStreetMap places (idempotent, resumable, fair-use rate-limited):

```bash
npm run import:osm                                  # all mapped categories × 12 cities
node scripts/import-osm.ts --city=Berlin --category=skateparks   # targeted top-up
node scripts/import-osm.ts --dry-run --city=Istanbul --category=drinking-water --limit=5
```

The delivered workspace ships with a pre-built `app/db/nerde.sqlite` containing **25,296 real places** (25,284 OSM imports across 12 cities + 12 curated demo entries). Delete it and re-run `npm run seed` for a clean start.

### Other scripts

```bash
npm test         # 77 API/security/schema tests (Vitest, isolated temp DBs)
npm run build    # type-check + production build → dist/
npm start        # production server: node server/serve.ts (serves dist/ + API + /uploads)
```

Configuration: copy `app/.env.example` → `app/.env` (DB path, upload dir, seed admin credentials, Overpass contact email, `NERDE_TRUST_PROXY` behind a reverse proxy). Seeded admin login: `admin@nerde.local` / `nerde-admin-2026` — **change before any real deployment**.

## Production deployment (summary — details in ARCHITECTURE.md §Deployment)

Single cheap VPS or container:

```bash
npm ci && npm run build && npm run seed
PORT=80 NERDE_TRUST_PROXY=1 node server/serve.ts
```

Put a TLS reverse proxy (Caddy/nginx) in front, persist `db/` + `public/uploads/` (and back them up), set strong admin credentials. Estimated cost at MVP scale: ~$6–12/month, no map-tile bills while within the OSM tile-usage policy (vector-tile migration path documented when traffic grows).

## Data & licensing

Place data includes **© OpenStreetMap contributors** ([ODbL](https://www.openstreetmap.org/copyright)) — attribution is shown in the map UI and search footer; see `DATA_SOURCES.md` for the produced-work reasoning and per-tag mappings. Photos are user-contributed. "Community demo" entries are explicitly labeled and meant to be replaced by real community data.

## Known limitations (honest list — see CRITICAL_REVIEW.md for the full review)

- Client-rendered SPA: SEO relies on client-side meta/JSON-LD + dynamic sitemap; the prerender/SSR escape hatches are designed and scheduled, not built.
- Imported places have no photos and mostly no addresses yet (enrichment = backlog P1-11); uploaded photos are not server-side re-encoded/EXIF-stripped yet (P1-12).
- OSM coverage is uneven: 12 seed cities; some category×city combos are still gaps (the importer is resumable — re-run it anytime).
- Single-process rate limiting and single-writer SQLite: fine for MVP validation, not for scale-out (documented upgrade path).

## Post-MVP direction

Community-created categories, curated maps, and a public structured API ("physical-world knowledge layer") — see `MVP_BACKLOG.md` P2 and `MASTER_PROMPT.md` §30. The architecture deliberately keeps those doors open.
