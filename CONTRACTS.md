# Nerde.com — Shared Contracts (single source of truth)

All agents MUST follow this file. It pins the decisions that multiple agents depend on.
Anything not covered here may be decided by the responsible agent and documented in its deliverable.
Master prompt: see `MASTER_PROMPT.md` in the same directory.

## 0. Product in one line

Nerde.com = map-first discovery of **highly specific categories of physical places**
("Where can I find X?"), community-editable, seeded from open data.

MVP priority categories: **calisthenics**, **arm-wrestling**, **vanlife**.

## 1. Tech stack (decided — do not revisit)

| Layer | Decision | Reason |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite 7 + Tailwind 3.4 + shadcn/ui | Local toolchain mandate; fast dev |
| Routing | `react-router-dom` v6/v7 (client-side) | SPA; SEO path documented in SEO_STRATEGY.md |
| Map | MapLibre GL JS + OSM raster tiles (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) | No token, no lock-in; vector-tile migration documented |
| Clustering | MapLibre built-in GeoJSON `cluster: true` (supercluster) | No extra dep, proven |
| Backend | Node HTTP API implemented as **Vite dev-server middleware** in dev, plus `server/serve.ts` for prod | Single `npm run dev` command; zero extra infra |
| Runtime | Node ≥ 22.18 (24 on this machine), native TS type-stripping for `server/` + `scripts/` | No build step for server code — **only erasable TypeScript** (no enums, no parameter properties, no namespaces) |
| DB | SQLite via built-in `node:sqlite` (`DatabaseSync`) | Zero-dependency, self-contained; PostGIS migration path documented in DATABASE.md |
| Auth | Email+password, scrypt hash (`node:crypto`), session token in httpOnly cookie, `sessions` table | Low maintenance; Google OAuth deferred (documented) |
| Photos | Client-side canvas resize (max 1600 px, JPEG q0.8) → base64 JSON POST → stored under `public/uploads/` | No native deps |
| Geocoding | Nominatim from the browser (place-name search), attribution + 1 req/s debounce | No key needed at MVP scale |
| Tests | Vitest (unit + API) | Runs server handlers in-process |
| Analytics | Own `events` table + `POST /api/events` | Privacy-conscious, no third party |

## 2. Repository layout

```
NeNerde/                  (workspace root — all docs live here)
  MASTER_PROMPT.md  CONTRACTS.md  README.md
  PRODUCT_SPEC.md  MVP_BACKLOG.md  ARCHITECTURE.md  DATABASE.md
  DESIGN_SYSTEM.md  DATA_SOURCES.md  SEO_STRATEGY.md
  TEST_PLAN.md  CRITICAL_REVIEW.md
  app/                      (the website project root)
    index.html  vite.config.ts  package.json  .env.example
    src/                    (frontend — OWNED by Frontend agent)
      main.tsx  App.tsx  index.css
      lib/api-types.ts      (pinned types — do not change without noting in CONTRACTS)
      lib/api.ts  lib/seo.ts  lib/format.ts
      pages/  components/  components/ui/ (shadcn, pre-installed)
    server/                 (API — OWNED by Backend agent)
      index.ts              (connect-style middleware: handles /api/*, /sitemap.xml, /robots.txt)
      db.ts  auth.ts  rateLimit.ts  validate.ts
      routes/*.ts
      serve.ts              (prod: static dist/ + same API)
    db/
      migrations/001_init.sql (and up)
      seed.mts? no → seed run via scripts/
    scripts/
      seed.ts               (categories + attribute definitions + admin user + curated places)
      import-osm.ts         (Overpass → places, idempotent via source_ref)
    public/uploads/         (user photos, gitignored)
    tests/                  (Vitest — OWNED by QA agent)
```

File ownership (implementation wave): Backend agent = `server/`, `db/`, `scripts/` only.
Frontend agent = `src/` only (except `src/lib/api-types.ts` which is frozen by contract).
QA agent = `tests/`, `TEST_PLAN.md` only. Nobody else edits `package.json` (deps pre-installed by orchestrator).

## 3. URL structure (permanent — SEO)

| URL | Page |
|---|---|
| `/` | Map-first home (product IS the homepage; no marketing landing) |
| `/c/:slug` | Category map + SEO text block, e.g. `/c/calisthenics` |
| `/place/:slug` | Place detail, e.g. `/place/macka-calisthenics-park` |
| `/add?lat=&lng=` | Add Place flow |
| `/saved` | User favorites |
| `/login` | Auth (sign in / sign up) |
| `/admin` | Admin panel |
| `/u/:username` | Minimal public profile (optional, cheap) |

Reserved future: `/c/:slug/:country`, `/c/:slug/:country/:city` — do NOT build now; note in SEO_STRATEGY.md.
Slugs: kebab-case. Place slug = slugified name + short id suffix (`macka-calisthenics-park-a3f9`).

## 4. Categories + attribute schema (seed set — 18)

`type` ∈ `bool | enum | number | text`. `filterable`=true → appears as a filter chip.
Attribute keys: snake_case. **Backend + Frontend + Data agents must use exactly these.**

Group `fitness`:
1. `calisthenics` 💪 Calisthenics Parks — pull_up_bars(b,f), parallel_bars(b,f), monkey_bars(b,f), rings(b,f), dip_bars(b,f), lighting(b,f), free(b,f), access_24_7(b,f), indoor_outdoor(enum outdoor/indoor), ground_surface(enum rubber/concrete/grass/sand/mixed)
2. `arm-wrestling` 🦾 Arm Wrestling — dedicated_club(b,f), armwrestling_table(b,f), regular_training(b,f), competition_team(b), membership_required(b,f), drop_ins(b,f), schedule(text)
3. `outdoor-gyms` 🏋️ Outdoor Gyms — free(b,f), lighting(b,f), access_24_7(b,f), shaded(b), equipment(text)
4. `powerlifting` 🏋️‍♂️ Powerlifting Gyms — competition_plates(b), deadlift_platform(b,f), squat_racks(number), membership_required(b,f), drop_ins(b,f), day_pass_price(number)
5. `climbing` 🧗 Climbing / Bouldering — indoor_outdoor(enum), bouldering(b,f), rope_climbing(b), free(b,f), crash_pads_needed(b), rock_type(enum granite/limestone/sandstone/other)
6. `skateparks` 🛹 Skateparks — indoor_outdoor(enum), free(b,f), lighting(b,f), bowl(b), street_section(b), surface(enum concrete/wood/metal)
7. `parkour` 🤸 Parkour Spots — free(b,f), lighting(b), access_24_7(b), indoor_outdoor(enum)
8. `basketball` 🏀 Basketball Courts — hoops(number), free(b,f), lighting(b,f), indoor_outdoor(enum), surface(enum asphalt/concrete/synthetic/wood), nets(b)
9. `table-tennis` 🏓 Public Table Tennis — free(b,f), indoor_outdoor(enum), tables(number), lighting(b), bring_own_paddles(b,f)

Group `outdoor`:
10. `vanlife` 🚐 Vanlife Spots — overnight_allowed(b,f), free(b,f), toilet(b,f), shower(b), drinking_water(b,f), electricity(b), waste_disposal(b), quiet(b,f), height_restriction(text), max_vehicle_length(number), mobile_signal(enum none/weak/good)
11. `overnight-parking` 🅿️ Overnight Parking — overnight_allowed(b,f), free(b,f), toilet(b), quiet(b,f), security(b), height_restriction(text)
12. `public-showers` 🚿 Public Showers — free(b,f), hot_water(b), access_24_7(b,f), indoor_outdoor(enum), price(number)
13. `drinking-water` ⛲ Drinking Water — free(b,f), access_24_7(b), seasonal(b), potable_confirmed(b)
14. `bbq-picnic` 🍖 BBQ & Picnic Areas — free(b,f), bbq_grill(b,f), fire_allowed(b), tables(b), toilets_nearby(b), drinking_water(b)
15. `swimming-spots` 🏊 Swimming Spots — free(b,f), water_type(enum sea/lake/river/pool,f), cold_water(b), entry_type(enum beach/rocks/dock), lifeguard(b)
16. `viewpoints` 🌄 Viewpoints — free(b), access_24_7(b), sunset_facing(b,f), sunrise_facing(b), seating(b), hike_required(b,f)
17. `sunset-spots` 🌇 Sunset Spots — free(b), west_facing(b), seating(b), crowded(enum quiet/moderate/busy,f)
18. `photo-spots` 📷 Photography Spots — free(b), best_time(enum sunrise/golden_hour/blue_hour/night/anytime,f), subject(enum cityscape/nature/architecture/wildlife/street,f), drone_friendly(b,f)

(b = bool, f = filterable. Every category also gets free-text `description` on the place itself.)

## 5. Database schema (SQLite — exact table/column names)

Hybrid attribute model: attribute **definitions** are relational (`category_attributes`),
attribute **values** live in `places.attrs` JSON keyed by `<category_slug>.<key>`
(namespaced because a place can have several categories with overlapping keys).
Filters use `json_extract`. Reasoning + PostGIS path go in DATABASE.md.

```sql
users(id INTEGER PK, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', -- user|admin
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
sessions(token TEXT PK, user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL);
categories(id INTEGER PK, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📍', color TEXT NOT NULL DEFAULT '#2563eb',
      grp TEXT NOT NULL DEFAULT 'outdoor', sort INTEGER NOT NULL DEFAULT 0);
category_attributes(id INTEGER PK, category_id INTEGER NOT NULL REFERENCES categories(id),
      key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,       -- bool|enum|number|text
      options TEXT,                       -- JSON array for enum
      filterable INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
      UNIQUE(category_id, key));
places(id INTEGER PK, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', lat REAL NOT NULL, lng REAL NOT NULL,
      address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', country_code TEXT NOT NULL DEFAULT '',
      attrs TEXT NOT NULL DEFAULT '{}',   -- JSON {"calisthenics.pull_up_bars":true,...}
      status TEXT NOT NULL DEFAULT 'published',   -- published|pending|removed
      source TEXT NOT NULL DEFAULT 'community',   -- community|osm|curated
      source_ref TEXT,                            -- e.g. osm:node/123 — UNIQUE when not null
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_verified_at TEXT, confirm_count INTEGER NOT NULL DEFAULT 0, issue_count INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX places_source_ref ON places(source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX places_lat_lng ON places(lat, lng);
CREATE INDEX places_status ON places(status);
place_categories(place_id INTEGER NOT NULL REFERENCES places(id),
      category_id INTEGER NOT NULL REFERENCES categories(id), PRIMARY KEY(place_id, category_id));
CREATE INDEX pc_cat ON place_categories(category_id, place_id);
photos(id INTEGER PK, place_id INTEGER NOT NULL REFERENCES places(id), url TEXT NOT NULL,
      width INTEGER, height INTEGER, created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
favorites(user_id INTEGER NOT NULL REFERENCES users(id), place_id INTEGER NOT NULL REFERENCES places(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id, place_id));
verifications(id INTEGER PK, place_id INTEGER NOT NULL REFERENCES places(id),
      user_id INTEGER REFERENCES users(id), type TEXT NOT NULL,   -- confirm|issue
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
reports(id INTEGER PK, place_id INTEGER NOT NULL REFERENCES places(id),
      user_id INTEGER REFERENCES users(id), reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',      -- open|resolved|dismissed
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
comments(id INTEGER PK, place_id INTEGER NOT NULL REFERENCES places(id),
      user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',  -- published|removed
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
events(id INTEGER PK, type TEXT NOT NULL, user_id INTEGER,
      meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')));
```

Geo queries: bbox = `lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?` (+ antimeridian handling),
nearest = bbox pre-filter + haversine sort in JS (documented in DATABASE.md with PostGIS upgrade path).

## 6. API contract (all JSON; errors `{error:string, ...}` with 4xx/5xx)

Public:
- `GET /api/categories` → `{categories:[{id,slug,name,icon,color,grp,sort,attributes:[{key,label,type,options,filterable,sort}]}]}`
- `GET /api/places?bbox=w,s,e,n[&cat=slug][&attrs=k1,k2][&q=text][&limit=500]` → `{places:[PlaceSummary]}`; `attrs` = comma list of `cat.key` that must be truthy. Max limit 1000. Only `status='published'`.
- `GET /api/places/near?lat=&lng=&radius_km=30[&cat=]` → `{places:[PlaceSummary & {distance_km}]}` (max 50, for "Near Me" + duplicate check UI)
- `GET /api/places/:slug` → `{place: PlaceDetail}` (incl. categories[], attributes resolved with labels, photos[], comments[] w/ username, verification summary, saved-by-me flag, can_edit)
- `GET /api/search?q=` → `{categories:[...], places:[PlaceSummary...]}` (name/description LIKE, limit 8 each)
- `POST /api/places` (auth optional) body `{name, description, lat, lng, categories:[slug...], attrs:{}, address?, city?, country?, country_code?}` → duplicate scan (≤100 m AND (shared category OR name-similar)) → `409 {duplicates:[PlaceSummary]}` unless `force:true`. Success `201 {place:{id,slug}}`. Validates lat∈[-90,90], lng∈[-180,180], name 2–80 chars, ≥1 category, attrs keys must exist for that category.
- `POST /api/photos` (auth optional) `{place_id, dataUrl}` → `{url}`; JPEG/PNG ≤ 3 MB after client resize; stored `public/uploads/<nanoid>.jpg`.
- `POST /api/places/:id/verify` (auth) `{type:'confirm'|'issue', note?}` → updates counts + last_verified_at (confirm only). One active vote per user per place (latest wins).
- `POST /api/places/:id/comments` (auth) `{body}` (1–500 chars)
- `POST /api/places/:id/report` (auth optional) `{reason, note?}`
- `POST /api/places/:id/save` / `DELETE /api/places/:id/save` (auth)
- `POST /api/events` `{type, meta?}` — always 204; types from §26 of MASTER_PROMPT.md.

Auth:
- `POST /api/auth/signup` `{email, username, password}` → sets cookie; `409` on taken email/username
- `POST /api/auth/login` `{email, password}`; `POST /api/auth/logout`; `GET /api/auth/me` → `{user:{id,username,role}|null}`
- Cookie `nerde_session`, httpOnly, SameSite=Lax, 30-day expiry. scrypt: `scrypt$N$r$p$salt$hash` hex.

User:
- `GET /api/me/saved` (auth) → `{places:[PlaceSummary]}`
- `GET /api/me/places` (auth) → places I contributed

Admin (`role='admin'` only, else 403):
- `GET /api/admin/reports?status=open`, `POST /api/admin/reports/:id {status}`
- `POST /api/admin/places/:id {action:'publish'|'remove'|'restore'}` and `PUT /api/admin/places/:id` (edit fields)
- `POST /api/admin/categories`, `PUT /api/admin/categories/:id` (create/edit + attributes)
- `GET /api/admin/stats` → counts for dashboard

SEO infra (server middleware, not under /api):
- `GET /sitemap.xml` (static URLs + all categories + published places), `GET /robots.txt`

`PlaceSummary` = `{id, slug, name, lat, lng, categories:[{slug,name,icon,color}], photo_url:string|null, confirm_count, last_verified_at}`
`PlaceDetail` = PlaceSummary + `{description, address, city, region, country, attrs_resolved:[{category_slug, key, label, type, value}...], photos:[{url,width,height}], comments:[{username, body, created_at}], created_by_username, created_at, issue_count, source}`

Rate limit: POST endpoints 30/min/IP (in-memory bucket), photos 10/min/IP.
Spam: honeypot field `website` on POST /api/places (if filled → fake-200), server trims/escapes, comments/report length caps.

## 7. Cross-cutting decisions

- **Near Me** = browser geolocation only; coords never sent to server except as query params for the near search itself; nothing stored (privacy, §28).
- **i18n**: UI strings in `src/lib/strings.ts` (English source object); DB content Unicode-clean; country/region/city stored on places. Turkish later (§20).
- **Time**: ISO strings UTC; "Verified N days ago" computed client-side (`lib/format.ts`).
- **Design**: map dominates; minimal chrome; no gradients/glassmorphism; dark-on-light; mobile = map + floating controls (search, categories, filters, near-me, add). Details in DESIGN_SYSTEM.md.
- **Seed data**: `scripts/seed.ts` (categories + attributes above + admin user + ~20 curated showcase places with `source='curated'` + real sourced info) and `scripts/import-osm.ts` (Overpass, idempotent via `source_ref`, tag mapping in DATA_SOURCES.md, `© OpenStreetMap contributors` attribution shown in UI + DATA_SOURCES.md).
- **Admin seed**: email/pass from env `NERDE_ADMIN_EMAIL` / `NERDE_ADMIN_PASSWORD`, defaults `admin@nerde.local` / `nerde-admin-2026` (document; change in prod).
- **Env**: see `app/.env.example` — `PORT`, `NERDE_DB_PATH`, `NERDE_UPLOAD_DIR`, `NERDE_ADMIN_EMAIL`, `NERDE_ADMIN_PASSWORD`, `NERDE_OSM_ATTRIBUTION_EMAIL`.
- **npm scripts**: `dev` (vite + API middleware, port 7100 default), `build`, `preview`, `start` (`node server/serve.ts`), `seed` (`node scripts/seed.ts`), `import:osm` (`node scripts/import-osm.ts`), `test` (vitest).

---

## Amendments (post-Critical-Review, release-engineering pass)

These amend §5/§6/§7 in place; each traces to a CRITICAL_REVIEW.md finding and is
implemented in code + covered by tests.

1. **A1 — `POST /api/events` client_id placement (I2).** The client (`src/lib/events.ts
   track()`) now sends `{type, client_id, meta}` with `client_id` **top-level**. The server
   accepts top-level `client_id` and, as a legacy fallback, `meta.client_id` (which it lifts
   into the column and strips from the stored meta). Rationale: the old client nested
   `client_id` inside `meta` while the server read it top-level → the column was always NULL
   and the returning-user metric (§26) was silently dead.
2. **A2 — Rate-limit IP source (B2).** `clientIp()` keys on the socket `remoteAddress` by
   default and honors `X-Forwarded-For` **only when env `NERDE_TRUST_PROXY=1`** (documented
   in `app/.env.example`). serve.ts listens directly, so trusting XFF by default let any
   client rotate a spoofed IP per request and never trip the limiter.
3. **A3 — `POST /api/photos` requires auth + valid place (B2).** The endpoint now requires a
   logged-in user (**401** for guests) and a valid existing `place_id` (**400** missing /
   **404** unknown), and ALL validation (auth, place, MIME, size, magic bytes) runs **before
   any file is written** — no orphan files. Decision record: **photos require an account;
   anonymous place creation stays open and is moderated via reports — a deliberate friction
   tradeoff** (the add-flow photo step tells guests photos need an account and offers a
   sign-in link; the place itself still submits as a guest).
4. **A4 — `GET /api/places?bbox=` response shape (I1).** Now returns
   `{places, total_count, truncated}` where `total_count` is the full bbox count and
   `truncated = total_count > places.length`. When the row count exceeds the limit, the
   subset is `ORDER BY (p.id * 2654435761) % 100000` — a cheap deterministic hash that
   scatters spatially (import order clusters by city; this does not). The PostGIS migration
   (DATABASE.md upgrade path) replaces this with real spatial sampling/clustering. The
   frontend shows a dismissible "Showing a sample of {total_count} places — zoom in to see
   everything" hint (sidebar + mobile sheet) when `truncated` is true.
5. **A5 — `GET /api/categories` gains `place_count` (B3/B1a).** Each category object now
   carries `place_count: number` (published places only, single GROUPed query). Frontend
   CategoryChips renders it as a small badge; categories with 0 places stay visible, and
   category pages show the empty-state copy "No places mapped yet / Be the first to add one."
   with the `+ Add a place` button (`strings.map.emptyCategoryTitle/emptyCategoryBody`).
6. **A6 — sitemap.xml thin-place exclusion (B1b).** A published place is excluded from
   `sitemap.xml` when it has **no photos AND empty description AND a generic fallback name**
   (name equals any category name case-insensitively, or matches
   `^(drinking water|picnic table|bench|viewpoint)$` — implemented as the documented
   `GENERIC_FALLBACK_NAME_RE` heuristic constant in `server/routes/seo.ts`). Thin places stay
   reachable on the map and at their URLs; they are just not submitted to crawlers. Noted in
   SEO_STRATEGY.md §6.5.
7. **A7 — `src/lib/api-types.ts` changes.** `Category` gains `place_count: number`; new
   `PlacesListResponse { places, total_count, truncated }` is the bbox-list response;
   `POST /api/photos` is documented as auth-required (A3). No other pinned types changed.
8. **A8 — Env.** `.env.example` gains `NERDE_TRUST_PROXY` (see A2), commented out by default.
9. **A9 — `PlaceSummary` gains `city: string` + `country_code: string` (UX_REVIEW F2).** Both
   are `''` when unset; every summary query selects them and cards render "City, CC".
   `scripts/import-osm.ts` writes them at insert time from the CITIES entry;
   `scripts/backfill-city.ts` (`node scripts/backfill-city.ts`) idempotently backfills
   existing rows whose lat/lng falls inside one of the 12 CITIES bboxes.
