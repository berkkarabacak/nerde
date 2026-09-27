# Nerde.com — Product Specification (MVP)

Owner: Product Lead. Binding technical decisions live in [CONTRACTS.md](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\CONTRACTS.md); this spec must not contradict it. Origin brief: [MASTER_PROMPT.md](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\MASTER_PROMPT.md).

---

## 1. Vision & MVP hypothesis

**Vision:** Categorize the physical world far more deeply than conventional map products do. Nerde.com answers one question — **"Where can I find X?"** — for highly specific categories (calisthenics parks, arm-wrestling clubs, vanlife spots, public showers…) that mainstream maps handle poorly.

**The one hypothesis the MVP validates (§4):**

> People want a map for discovering highly specific categories of physical places, and some of those people are willing to contribute locations themselves.

Strongest early signal (§26): **users begin adding locations without being personally asked.**

MVP qualities (§4): fast, mobile-friendly, map-first, searchable, SEO-friendly, community-editable, architecturally extensible, cheap to operate. Useful immediately — the product IS the homepage.

---

## 2. Target users — 3 personas

1. **Mert, 24 — traveling calisthenics athlete (priority category: `calisthenics`).**
   Lands in a new city, wants a park with pull-up bars and parallel bars, free, ideally lit at night. Google Maps shows "gyms" — useless. Needs: pick category → filter attributes → inspect place → save it.
2. **Sara, 31 — vanlifer on a 3-month Europe trip (priority category: `vanlife`).**
   Every evening: where can I legally sleep, is it free, is there water/a toilet, is it quiet? Needs: Near Me + attribute filters (`overnight_allowed`, `free`, `drinking_water`) + fresh verification ("confirmed 5 days ago").
3. **Deniz, 28 — arm-wrestling club member & contributor (priority category: `arm-wrestling`).**
   Knows every club and training gym in his region; annoyed the scene is invisible online. Wants to put it on the map: add places, upload photos, confirm existing entries, flag wrong info.

Secondary (post-MVP): photographers (`photo-spots`), swimmers (`swimming-spots`), students (24h spots — category not seeded yet).

---

## 3. Primary user journeys

### J1 — Discover (the core loop, §7)
**Choose category → explore map → inspect place.**
1. Open `/` (or shared `/c/:slug` link) → map dominates, zero marketing gate.
2. Pick category (chip/list) or search "calisthenics" → URL becomes `/c/calisthenics`.
3. Pan/zoom → markers reload for visible bbox, clustered.
4. Optional: Near Me (browser geolocation), attribute filter chips.
5. Click marker → preview card → open `/place/:slug`.
6. See photos, attributes, verification status, address; open in external maps; copy/share URL.

### J2 — Add a place (§11 — one of the most important MVP features)
1. "+ Add" → `/add?lat=&lng=` (pin pre-dropped at map center / user location; draggable).
2. Select ≥1 category → dynamic attribute form for those categories.
3. Name + description.
4. Duplicate check runs automatically (≤100 m + shared category or name-similar) → "Is this already one of these places?" → user picks existing or confirms new (`force:true`).
5. Add photos (client-resized) → submit → lands on new `/place/:slug`.
6. Works as guest; account not required (see §8 ambiguities).

### J3 — Verify / save (§12, §14)
1. On a place page, signed-in user taps **♡ Save** → appears under `/saved`.
2. Taps **✓ Confirm** ("still exists") or **⚠ Something is wrong** (+ optional note) → place shows "Verified N days ago" and updated counts.
3. Taps **Report** → reason + note → admin queue.
4. Sign-up friction is deferred until one of these actions requires it.

---

## 4. MVP scope — explicit IN list

| # | Feature | Contract anchor |
|---|---|---|
| 1 | **Map-first home** `/` — product is the homepage; map + floating controls | URLs §3 |
| 2 | **18 seed categories** (fitness 9 + outdoor 9) with per-category attribute definitions (`bool/enum/number/text`, `filterable` flags) | Categories §4 |
| 3 | **BBox-based loading** — places queried by visible bounds (+ antimeridian), clustered via MapLibre supercluster; never a global dump | API §6 `GET /api/places?bbox=` |
| 4 | **Category + attribute filters** — filter chips generated from `category_attributes` where `filterable=1`; server-side `attrs=` truthy filter | API §6 |
| 5 | **Search** — one field "What are you looking for?": categories + place name/description (`GET /api/search?q=`) + Nominatim geocoding from browser (1 req/s debounce, attribution) | API §6, stack §1 |
| 6 | **Place pages** `/place/:slug` — permanent, indexable; photos, resolved attributes, verification, comments, save/report, external-maps link | URLs §3, `PlaceDetail` §6 |
| 7 | **Add Place with photos** — 5-step flow, multi-category, dynamic attrs, duplicate scan (`409` + `force:true`), client-side JPEG resize ≤1600 px → `POST /api/photos` | API §6 |
| 8 | **Auth** — email+password (scrypt), httpOnly `nerde_session` cookie (30 d), signup/login/logout/me | API §6, stack §1 |
| 9 | **Favorites** — save/unsave, `/saved` page, `GET /api/me/saved`; saves tracked as product signal | API §6 |
| 10 | **Verification** — event-sourced `verifications` table; confirm/issue; one active vote per user per place (latest wins); `last_verified_at`, `confirm_count`, `issue_count` on place | Schema §5, API §6 |
| 11 | **Reports** — `POST /api/places/:id/report`, open/resolved/dismissed queue | Schema §5 |
| 12 | **Admin panel** `/admin` — categories + attribute CRUD, place edit/publish/remove/restore, report review, stats dashboard | API §6 (admin) |
| 13 | **OSM seed + curated seed** — `scripts/seed.ts` (categories, admin user, ~20 curated places) and `scripts/import-osm.ts` (Overpass, idempotent via `source_ref`, attribution "© OpenStreetMap contributors") | Cross-cutting §7 |
| 14 | **Analytics events** — own `events` table + `POST /api/events` (always 204); the 10 event types of §25 | Schema §5 |
| 15 | **SEO infra** — permanent URLs, `/sitemap.xml`, `/robots.txt`, per-route metadata, category SEO text block | URLs §3, API §6 |
| 16 | **Comments (basic)** — account-required, 1–500 chars, published/removed | Schema §5 |
| 17 | **Abuse safeguards** — 30/min POST rate limit (10/min photos), honeypot `website`, input validation, coordinate bounds, length caps | API §6 |
| 18 | **Mobile-first UX** — map + floating controls (search, categories, filters, near-me, add); intentional design, not shrunk desktop | Cross-cutting §7 |

## 5. MVP scope — explicit OUT list (MASTER_PROMPT §29, verbatim)

- AI chatbot
- Native Android app / native iOS app
- Turn-by-turn navigation
- Complex route planning
- Social feeds
- Followers
- Direct messaging
- Influencer features
- Complex reputation systems
- Badges
- Cryptocurrency
- Reservation systems
- Advertising marketplace
- Paid subscriptions
- Business dashboards
- Advanced recommendation algorithms

Also OUT (deferred by contract): Google OAuth, `/c/:slug/:country[/:city]` pages, community-created categories, curated maps, public API (→ P2 backlog), Turkish UI, verification confidence scoring (schema-ready only).

---

## 6. Feature acceptance criteria

Testable statements. DoD #n references the Definition of Done step in MASTER_PROMPT §34.

### 6.1 Map-first home `/`
- [ ] Given a new visitor opens `/`, when the page loads, then the map fills ≥80% of the viewport with search + category controls visible and no marketing/scroll gate. (DoD #1–2)
- [ ] Given the visitor reads the header/search for ≤5 s, then they can state the site finds specific categories of places (calisthenics example visible in UI). (DoD #2)
- [ ] First load fetches only the current bbox, never all places.

### 6.2 Categories (18 seed)
- [ ] Given seed ran, when `GET /api/categories`, then exactly the 18 slugs of CONTRACTS §4 return, each with icon, group (`fitness|outdoor`), and attribute definitions with correct `key/label/type/options/filterable`.
- [ ] Given home page, when visitor clicks **Calisthenics**, then URL becomes `/c/calisthenics` and only calisthenics places render. (DoD #3–4)
- [ ] Priority trio `calisthenics`, `arm-wrestling`, `vanlife` each have ≥1 real seeded place visible without zooming to an empty ocean. (DoD #4)

### 6.3 Bbox loading & clustering
- [ ] Given `/c/:slug` open, when the user pans/zooms, when the map idles, then a new `GET /api/places?bbox=w,s,e,n&cat=slug` fires and markers update to match the viewport. (DoD #5–6)
- [ ] Response contains only `status='published'` places, ≤1000, `PlaceSummary` shape.
- [ ] Dense areas render as clusters that expand on click/zoom; no client-side full-dataset clustering.
- [ ] Bbox crossing the antimeridian returns correct results.

### 6.4 Attribute filters
- [ ] Given a category selected, when `filterable=1` attributes exist, then chips render (e.g. `calisthenics`: Pull-up bars, Parallel bars, Lighting, Free, 24/7). (DoD #8)
- [ ] When a chip is toggled, then `GET /api/places?...&attrs=cat.key` returns only places where that attr is truthy, and markers + list update.
- [ ] Chips change when category changes (dynamic per `category_attributes`).

### 6.5 Search
- [ ] Given the search field, when user types "arm wrestling", then category `arm-wrestling` appears and selecting it navigates to `/c/arm-wrestling`.
- [ ] When user types a place name substring, then up to 8 matching `PlaceSummary` results appear (`GET /api/search?q=`).
- [ ] When user types "Istanbul"/"Berlin", then Nominatim result recenters the map (browser-side call, debounced ≥1 req/s, attribution shown).
- [ ] `search_performed` event fires per executed search.

### 6.6 Near Me
- [ ] Given geolocation granted, when user taps Near Me, then map centers on user and `GET /api/places/near?lat=&lng=&radius_km=30` results show with `distance_km`. (DoD #7)
- [ ] Coordinates are never persisted server-side (only transient query params). (§28)
- [ ] Given permission denied, then a non-blocking fallback message appears and the map stays usable.

### 6.7 Place page `/place/:slug`
- [ ] Given a marker click, when preview opens, then card shows name, categories, photo, confirm count, "Verified N days ago" (client-computed, UTC ISO stored). (DoD #9)
- [ ] Given the full page, then it shows: description, address/city/country, attributes resolved with labels per category, photo gallery, comments with usernames, created-by username, save ♡, confirm ⚠/✓, report, "Open in external maps" link. (DoD #10)
- [ ] URL is permanent, kebab-case slug + short id suffix, shareable, and present in `/sitemap.xml`. (DoD #17)
- [ ] Unknown slug → 404 state, not a crash.

### 6.8 Add Place `/add?lat=&lng=`
- [ ] Given "+ Add", when the flow opens, then a draggable pin sits at map center (or geolocation); lat/lng update live. (DoD #13)
- [ ] Validation blocks: name <2 or >80 chars, lat∉[-90,90], lng∉[-180,180], zero categories, attr keys not defined for the chosen category.
- [ ] Given a place exists ≤100 m with shared category or similar name, when user submits, then API returns `409 {duplicates:[...]}` and UI asks "Is this already one of these places?"; choosing "it's new" resubmits with `force:true` → `201 {place:{id,slug}}`.
- [ ] Guest submission succeeds without login; honeypot `website` field silently fake-200s bots.
- [ ] Photos: user selects images → client resizes to ≤1600 px JPEG q0.8 → `POST /api/photos` (≤3 MB) → photos visible on the new place page. (DoD #14)
- [ ] `add_place_started` fires on flow open; `place_submitted` on success.

### 6.9 Auth `/login`
- [ ] Given signup with valid email/username/password, then cookie `nerde_session` (httpOnly, SameSite=Lax, 30 d) is set and `GET /api/auth/me` returns the user. (DoD #11)
- [ ] Duplicate email/username → `409`; wrong password → generic error (no user enumeration).
- [ ] Logout clears session; protected endpoints return 401 when logged out.
- [ ] Non-admin hitting `/api/admin/*` → 403.

### 6.10 Favorites `/saved`
- [ ] Given signed-in user on a place page, when ♡ Save tapped, then `POST /api/places/:id/save` succeeds, heart fills, `place_saved` event fires. (DoD #12)
- [ ] `/saved` lists all saved `PlaceSummary` items; unsave removes immediately.
- [ ] Given guest taps ♡, then they are routed to `/login` and the save completes after auth (or clearly resumes).

### 6.11 Verification
- [ ] Given signed-in user, when they tap ✓ Confirm, then `confirm_count` +1, `last_verified_at`=now, UI shows "Verified today", `place_verified` event fires. (DoD #15)
- [ ] When the same user votes again, then latest vote wins (no double-count).
- [ ] Given ⚠ Something is wrong, when submitted with optional note, then `issue_count` +1 and a verification row with `type='issue'` is stored.
- [ ] Verification history is stored as events (rows), never a single boolean.

### 6.12 Reports & comments
- [ ] Given any user (guest allowed), when they report with a reason, then a `reports` row with `status='open'` exists and appears in admin. (DoD #16)
- [ ] Given signed-in user, when they comment (1–500 chars), then it appears with username; guests get the login prompt.
- [ ] `place_reported` event fires per report.

### 6.13 Admin `/admin`
- [ ] Given admin login (seeded env credentials), then dashboard shows stats (`GET /api/admin/stats`).
- [ ] Admin can: create/edit categories + their attribute definitions; edit any place field; publish/remove/restore a place; resolve/dismiss reports. Removed places disappear from public APIs.
- [ ] Given `role='user'`, all admin routes 403 and `/admin` UI is unreachable.

### 6.14 Seed & OSM import
- [ ] `npm run seed` creates: 18 categories + attributes, admin user, ~20 curated places (`source='curated'`, real info, weighted to the priority trio).
- [ ] `npm run import:osm` imports Overpass results with `source='osm'`, `source_ref='osm:node/123'…`; re-running creates zero duplicates (unique partial index on `source_ref`).
- [ ] "© OpenStreetMap contributors" attribution visible in UI.
- [ ] After seed+import, opening `/c/calisthenics` in a covered area shows real places. (DoD #4)

### 6.15 Analytics
- [ ] `POST /api/events` accepts the 10 §25 types (`category_selected, search_performed, place_viewed, place_saved, add_place_started, place_submitted, place_verified, place_reported, filter_applied, near_me_used`), always 204, never blocks UI.
- [ ] Each event row stores `type`, nullable `user_id`, JSON `meta` (incl. `client_id`, category slug where relevant), UTC timestamp.

### 6.16 SEO
- [ ] `/c/:slug` and `/place/:slug` serve unique title/description metadata and an indexable text block (category intro / place facts) per SEO_STRATEGY.md.
- [ ] `/sitemap.xml` lists static pages + all categories + all published places; `/robots.txt` allows crawling and references the sitemap.
- [ ] Shared URLs render correctly when opened fresh (deep-linkable). (DoD #17)

### 6.17 Cross-cutting
- [ ] Every DoD flow passes on desktop (≥1280 px) and mobile (≤390 px) — mobile uses floating controls, not a shrunk desktop layout. (DoD final clause)
- [ ] UI strings live in `src/lib/strings.ts`; all DB content Unicode-clean.

---

## 7. Success metrics (§26) → measurement via `events` table

All events: `POST /api/events {type, meta}` → `events(id, type, user_id, meta, created_at)`. Anonymous identity = `meta.client_id` (random UUID in localStorage, no location/fingerprint). `meta.cat` carries the category slug on category-scoped events.

| §26 metric | Question | Events used | Computation |
|---|---|---|---|
| Search → Place View | Are people finding locations worth opening? | `search_performed`, `place_viewed` | % of weekly search sessions (by `client_id`) with a `place_viewed` ≤10 min after a search. Target direction: rising; baseline set week 1. |
| Place View → Save | Are places useful enough to save? | `place_viewed`, `place_saved` | `place_saved` count / unique places viewed per week; also saves per 100 place views. |
| User → Contribution | Do people voluntarily add places? | `add_place_started`, `place_submitted` | Funnel completion `submitted/started`; weekly `place_submitted` from non-admin, non-seed users. **Strongest signal = any unsolicited organic `place_submitted`.** |
| Verification activity | Are users improving existing data? | `place_verified` (meta.type=confirm\|issue), `place_reported` | Weekly counts; % of published places with ≥1 confirm in last 90 days (join `places.last_verified_at`). |
| Returning users | Do people come back? | all events | % of weekly active `client_id`/`user_id` with events on ≥2 distinct UTC days; week-over-week retained cohorts. |
| Geographic/category density | Which categories develop active communities? | `category_selected`, `filter_applied`, `place_viewed`, `place_submitted` (each with `meta.cat`) + `places` table | Demand (events per cat) vs supply (published places per cat per country) ranked weekly; highlights e.g. calisthenics/TR hotspots. |

Instrumentation rule: every UI action above fires its event before/at success — analytics is a P0 acceptance criterion, not an afterthought.

---

## 8. Ambiguities resolved (and how)

1. **Category URL prefix.** MASTER_PROMPT examples show `/calisthenics`; CONTRACTS pins `/c/:slug` to avoid collisions with future top-level routes (`/add`, `/saved`, `/admin`). Spec follows CONTRACTS.
2. **Guest contributions.** Allowed for add-place, photos, reports (`auth optional`) to keep §11 friction minimal; **save, verify, comment require an account** (anti-abuse + makes favorites/verification signals meaningful).
3. **Moderation model.** Reactive, not pre-moderation: submissions go live as `status='published'` immediately; guards = validation, honeypot, rate limits, duplicate scan, report queue, admin remove. `pending` status reserved for future use.
4. **Google login.** Deferred (CONTRACTS §1); email+password only for MVP.
5. **Comments.** Basic, flat, account-required, 1–500 chars; no threads/reactions (social features OUT per §29).
6. **Near Me privacy.** Browser geolocation only; coords travel solely as query params of the near request; nothing stored (§28).
7. **Returning-user measurement without tracking.** `client_id` = random localStorage UUID sent in `events.meta`; no device location or fingerprint persisted.
8. **Duplicate rule.** ≤100 m AND (shared category OR name-similar) → `409 {duplicates}`; contributor may override with `force:true`. No ML.
9. **Verification semantics.** One active vote per user per place, latest wins; MVP displays counts + "Verified N days ago" (computed client-side from UTC). Confidence scoring (recency × reputation × conflicts) explicitly post-MVP, but `verifications` rows already capture user/timestamp/type/note to enable it.
10. **Multi-category places.** Many-to-many via `place_categories`; attribute values namespaced `cat.key` inside `places.attrs` JSON — no per-category tables, no migrations for new attributes.
11. **SEO with SPA stack.** Permanent URLs + per-route meta + category text blocks + sitemap/robots as server middleware; rendering/indexation tactics owned by SEO_STRATEGY.md. City/country pages reserved (`/c/:slug/:country[/:city]`), not built.
12. **Seed category count.** Fixed at exactly the 18 of CONTRACTS §4 (within §5's 10–20 range); priority trio calisthenics / arm-wrestling / vanlife gets the strongest curated seed.
13. **Empty-map risk.** Mitigated by curated seed + OSM import before launch (DoD #4 "see real locations"); a map area with zero results should invite contribution rather than show dead space.
