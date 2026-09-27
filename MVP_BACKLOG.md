# Nerde.com — MVP Backlog

Owner: Product Lead. Priorities: **P0** = must for MVP (blocks Definition of Done, MASTER_PROMPT §34), **P1** = fast follow (first weeks after launch), **P2** = later / post-MVP.
Sizes (agent effort, relative): **S** ≈ hours, **M** ≈ 1–2 days, **L** ≈ 3+ days.
Scope guard: everything here traces to [PRODUCT_SPEC.md](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\PRODUCT_SPEC.md) and [CONTRACTS.md](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\CONTRACTS.md); nothing from MASTER_PROMPT §29 appears below as work.

---

## P0 — must for MVP

| # | Item | Rationale (one line) | Size |
|---|---|---|---|
| P0-01 | Repo scaffold per CONTRACTS §2 (`app/`, vite config, pre-installed deps, `.env.example`) | Shared foundation before parallel agent work (§32). | S |
| P0-02 | `db/migrations/001_init.sql` — full schema of CONTRACTS §5 incl. indexes | Every feature depends on users/places/categories/attrs tables. | M |
| P0-03 | `src/lib/api-types.ts` frozen types (`PlaceSummary`, `PlaceDetail`, API payloads) | Prevents frontend/backend interface drift (§32). | S |
| P0-04 | `GET /api/categories` | Category selector + filter chips + admin all read this. | S |
| P0-05 | `GET /api/places?bbox=` with `cat`, `attrs`, `q`, `limit≤1000`, published-only, antimeridian | Core loop: choose category → explore map (DoD #3–6). | M |
| P0-06 | `GET /api/places/near` (bbox pre-filter + haversine, ≤50) | Near Me + duplicate check UI (DoD #7). | S |
| P0-07 | `GET /api/places/:slug` (categories, resolved attrs, photos, comments, verification summary, saved-by-me) | Place page data (DoD #9–10). | M |
| P0-08 | `GET /api/search?q=` (categories + places, limit 8 each) | One search field for categories and places (DoD #2). | S |
| P0-09 | Auth: signup/login/logout/me, scrypt, `nerde_session` cookie, `sessions` table | Required for save/verify/comment/admin (DoD #11). | M |
| P0-10 | Save/unsave + `GET /api/me/saved` + `GET /api/me/places` | Favorites + contribution list (DoD #12). | S |
| P0-11 | `POST /api/places` with validation, honeypot, duplicate scan → `409`/`force:true` | Contribution is the #1 hypothesis signal (DoD #13). | M |
| P0-12 | `POST /api/photos` (JPEG/PNG ≤3 MB → `public/uploads/`) | Photos make places trustworthy (DoD #14). | M |
| P0-13 | `POST /api/places/:id/verify` (confirm/issue, latest-wins, counts + `last_verified_at`) | Data freshness is the product's moat (DoD #15). | S |
| P0-14 | `POST /api/places/:id/comments` + `POST /api/places/:id/report` | Basic community layer + abuse channel (DoD #16). | S |
| P0-15 | `POST /api/events` (10 §25 types, always 204) | Success metrics are unmeasurable without it. | S |
| P0-16 | Admin APIs: reports queue, place publish/remove/restore + edit, category+attr CRUD, stats | Moderation + category management (DoD #16 support). | M |
| P0-17 | Rate limiting (30/min POST, 10/min photos) + input validation helpers | §27 abuse floor before real users arrive. | M |
| P0-18 | Frontend shell: router, `/` `/c/:slug` `/place/:slug` `/add` `/saved` `/login` `/admin`, MapLibre + OSM raster, supercluster | The product itself; all journeys run here. | L |
| P0-19 | Home/category map UI: category selector, bbox-driven markers, preview cards | Core loop front half (DoD #1–6). | L |
| P0-20 | Filter chips generated from `filterable` attributes | Attribute filtering is the differentiator (DoD #8). | M |
| P0-21 | Search UI: "What are you looking for?" + category/place results + Nominatim (debounced, attribution) | Deterministic structured search, no LLM (§8). | M |
| P0-22 | Near Me control + permission-denied fallback, no location persistence | DoD #7 + §28 privacy. | S |
| P0-23 | Place page UI: gallery, resolved attrs, verification display, comments, save/report, external-maps link | DoD #9–10, #12, #15–16. | M |
| P0-24 | Add Place flow UI: 5 steps, draggable pin, dynamic attrs, duplicate prompt, photo resize (≤1600 px JPEG q0.8) | Contribution funnel (DoD #13–14). | L |
| P0-25 | Auth UI + guest→login redirects that resume the intended action | DoD #11; keeps J3 friction low. | S |
| P0-26 | `/saved` page | DoD #12. | S |
| P0-27 | Admin UI (functional over beautiful, §17) | Operate the platform day 1. | M |
| P0-28 | Mobile layout: map + floating controls (search/categories/filters/near-me/add) | Mobile is the primary context (§21; DoD final clause). | M |
| P0-29 | SEO infra: per-route meta, category SEO text block, `/sitemap.xml`, `/robots.txt` | §16: permanent indexable URLs (DoD #17). | M |
| P0-30 | Analytics instrumentation across all UI actions (10 event types, `client_id` in meta) | Wires §26 metrics end-to-end. | S |
| P0-31 | `scripts/seed.ts`: 18 categories + attributes, admin user, ~20 curated places | Empty map kills the product (§18; DoD #4). | M |
| P0-32 | `scripts/import-osm.ts`: Overpass → tag mapping → idempotent via `source_ref`, attribution | Real density in priority categories (DoD #4). | L |
| P0-33 | Vitest suites: auth, place CRUD + validation, duplicate scan, bbox/near queries, permissions | §34 requires verified-not-claimed functionality. | M |
| P0-34 | QA pass: desktop + mobile layouts, abuse inputs, DoD walkthrough end-to-end | Release gate. | M |
| P0-35 | README + local dev + prod run instructions (`dev/seed/import:osm/build/start`) | Deliverable §36.18–19. | S |

## P1 — fast follow

| # | Item | Rationale | Size |
|---|---|---|---|
| P1-01 | Google OAuth login | §13 "if practical"; reduces signup friction for saves/verifies. | M |
| P1-02 | ✅ DONE 2026-09-19 — Empty-area CTA: "No places here yet — add one" on zero-result bbox | Converts the worst UX moment into contribution (§26 strongest signal). | S |
| P1-03 | Reverse-geocode autofill (address/city/country) in Add Place step 1 | §11 "optionally reverse-geocode"; better data quality per submission. | S |
| P1-04 | `/u/:username` minimal public profile (places contributed) | CONTRACTS marks optional/cheap; rewards contributors. | S |
| P1-05 | OG/share metadata polish for place + category links | Improves DoD #17 sharing impact. | S |
| P1-06 | Photo moderation queue in admin (review newest uploads) | §27 inappropriate-image safeguard; reactive-only at MVP. | M |
| P1-07 | Verification confidence display v1 (recency-weighted label, e.g. "verified recently" vs "unverified for a year") | Cheap read of existing `verifications` rows; full scoring stays P2. | M |
| P1-08 | Per-user submission velocity heuristic + admin flag | Extends §27 rate limits beyond per-IP. | M |
| P1-09 | Curated seeding packs for 2–3 additional cities in priority categories | Density drives returning users (§26). | M |
| P1-10 | Performance tune: marker payload trim, thumbnail variants, bbox query caching | §24 headroom once real data lands. | M |
| P1-11 | 🟡 PARTIAL 2026-09-19 (names composed for 23,902 imports; 27 Commons photos w/ credit; street-address geocoding still open) — **Place data enrichment (CRITICAL_REVIEW B1, intentionally deferred from the release pass)**: batch reverse-geocode / Overpass `is_in`+addr to fill city/address for imported places; compose names from attrs ("Calisthenics park — Maçka, Istanbul") instead of one global fallback; seed photos (Wikimedia Commons, ODbL-compatible) for the ~50 DoD showcase places | DoD step 10 payoff is hollow today: 0/17,953 photos, 17,951 empty addresses, ~74% generic fallback names. Thin stubs are meanwhile excluded from the sitemap (A6). | L |
| P1-12 | ✅ DONE 2026-09-19 (server/imageSanitize.ts strips JPEG APP1/APP13/COM + PNG eXIf/tEXt before write; 4 tests) — **Server-side EXIF strip / re-encode for uploaded photos (CRITICAL_REVIEW B2-iv, intentionally deferred)**: after magic-byte validation, reject or strip JPEG APP1 Exif segments carrying GPS IFD (canvas re-encode covers only the honest browser path; direct API uploads keep full EXIF — a privacy leak for e.g. vanlife overnight spots) | §28 privacy; the current claim holds only for the browser path. | M |

## P2 — later / post-MVP

| # | Item | Rationale | Size |
|---|---|---|---|
| P2-01 | **Community-created categories** (§30) — users propose/create categories that grow into their own maps | §30 headline future; needs moderation model first. | L |
| P2-02 | **Curated maps / collections** (§30) — users/orgs maintain shareable place collections | Extends favorites into a public artifact. | L |
| P2-03 | **Public API** (§30) — structured geographic category data for apps/AI assistants | "Physical-world knowledge layer" positioning. | L |
| P2-04 | `/c/:slug/:country[/:city]` indexable pages (reserved URLs) | §16 SEO expansion once density justifies non-thin pages. | M |
| P2-05 | Turkish + additional UI languages (`strings.ts` → locale packs) | §20 global intent; English-first MVP. | M |
| P2-06 | Full verification confidence score (recency × confirmations × contributor reputation × conflicts) | §12 end-state; data model already captures inputs. | M |
| P2-07 | PostGIS migration (geography types, spatial indexes) per DATABASE.md upgrade path | Needed when place counts outgrow SQLite bbox scans. | L |
| P2-08 | Self-hosted vector tiles (replace OSM raster) | Cost/style control at scale; avoids tile-usage limits. | L |
| P2-09 | NL search parsing ("free showers near Barcelona") — deterministic first, LLM optional | §8 future; structured search must win first. | M |
| P2-10 | Lightweight contributor trust signals (history-based, not gamified) | Feeds P2-06 scoring; badges/reputation stay OUT. | M |

---

## Release checklist — maps 1:1 to Definition of Done (MASTER_PROMPT §34)

A fresh-visitor walkthrough on **both** desktop (≥1280 px) and mobile (≤390 px); every box must pass before release.

- [ ] 1. Open Nerde.com (`/`) with no account — loads clean.
- [ ] 2. Within ~5 s it reads as a specialized place-discovery map (no marketing gate).
- [ ] 3. Select **Calisthenics** → `/c/calisthenics`.
- [ ] 4. Real seeded/OSM locations render (not an empty map).
- [ ] 5. Pan/zoom elsewhere.
- [ ] 6. Markers update dynamically from bbox queries; clustering behaves.
- [ ] 7. Near Me works; denial path degrades gracefully; nothing location-wise stored server-side.
- [ ] 8. Attribute filter chips (e.g. Pull-up bars, Free, 24/7) narrow results correctly.
- [ ] 9. Open a place → `/place/:slug`.
- [ ] 10. Place shows useful info: resolved attributes, photos, verification status, comments.
- [ ] 11. Create an account (email+password) — session persists across reload.
- [ ] 12. Save the location → appears in `/saved`.
- [ ] 13. Add a missing place via `/add` (guest flow verified too) — duplicate prompt exercised.
- [ ] 14. Upload a photo → resized, stored, displayed.
- [ ] 15. Confirm an existing place → count + "Verified today" update.
- [ ] 16. Report incorrect information → appears in `/admin` queue; admin resolves it.
- [ ] 17. Copy/share a category and a place URL — both resolve fresh, carry correct meta, and appear in `/sitemap.xml`.

Release gates beyond the walkthrough:

- [ ] All 10 analytics event types verified firing into `events` (spot-check each).
- [ ] `npm run seed` + `npm run import:osm` run idempotently from a clean DB (zero duplicate `source_ref`).
- [ ] "© OpenStreetMap contributors" attribution visible in UI.
- [ ] Rate limits, honeypot, and coordinate/name validation confirmed by Vitest suites (`npm test` green).
- [ ] No §29 feature present in the build.
- [ ] Default admin credentials changed for production env.
