# Nerde.com — SEO & Organic Growth Strategy

Owner: Agent 8 (SEO / Growth Engineer). Governs URL architecture, rendering, structured data, metadata, indexation, and the first-1000-user organic plan.
Pinned by contract: React SPA on Vite (no SSR), URLs per `CONTRACTS.md` §3, `/sitemap.xml` + `/robots.txt` served by server middleware, 18 seed categories per §4.
Non-goal for MVP: geo pages, hreflang, SSR. All three have a pre-planned trigger and escape hatch below.

---

## 1. URL architecture

### 1.1 Final rules

| URL | Indexable | Canonical | Sitemap | robots.txt |
|---|---|---|---|---|
| `/` | yes | `https://nerde.com/` | yes | allow |
| `/c/:slug` | yes | self | yes | allow |
| `/place/:slug` | yes | self | yes | allow |
| `/c/:slug/:country` (phase 2) | yes, if eligible | self | yes, if eligible | allow |
| `/c/:slug/:country/:city` (phase 3) | yes, if eligible | self | yes, if eligible | allow |
| `/add`, `/saved`, `/login`, `/u/:username` | **no** (`noindex,follow` meta) | — | **no** | **not** disallowed (Google must crawl them to see the `noindex`) |
| `/admin`, `/api/*` | no | — | no | disallowed |
| Any `?bbox= / ?attrs= / ?q= / ?lat= / ?lng=` variant | no (`noindex,follow` + canonical to clean base) | clean base URL | **no** | allow |

Global normalization (server middleware, 301 permanent):
- `http://` → `https://`; `www.nerde.com` → `nerde.com` (apex is canonical host).
- No trailing slash: `/c/calisthenics/` → `/c/calisthenics`.
- Lowercase only: `/c/Calisthenics` → `/c/calisthenics`.
- Unknown `/c/:slug` → 404 (not a redirect to home — soft-404s waste crawl budget).

### 1.2 Slug rules

- **kebab-case**, lowercase, ASCII. Unicode place names are transliterated for the slug (`Maçka` → `macka`); the display name keeps full Unicode.
- **Place slug** = `{slugified-name}-{4-char suffix}` generated once at creation (contract example: `macka-calisthenics-park-a3f9`). The suffix guarantees uniqueness and makes the slug independent of the display name.
- **Category slugs** are the frozen set from `CONTRACTS.md` §4 (`calisthenics`, `arm-wrestling`, `vanlife`, …). New categories get kebab-case slugs at creation; a category slug is frozen the moment it is published.

### 1.3 Slug stability & redirects on rename

1. **Default: place slugs are immutable.** Renaming a place does NOT change its slug. A slightly stale slug costs nothing; a changed slug costs all accumulated ranking signals.
2. **Admin slug regeneration** (reserved for spam/garbage names) writes a row to a `slug_redirects(old_slug, new_slug)` map; middleware answers **301** for the old slug and the sitemap lists only the new one. Redirects are kept indefinitely.
3. **Duplicate merge**: the losing place's slug 301s to the winner. Loser is removed from the sitemap immediately.
4. **Removed places** (`status='removed'`): 404 (or 410) and dropped from the sitemap at next generation. Never redirect a removed place to a category page (soft-404).
5. **Category slug change**: treated as breaking — requires a 301 entry and an entry in the change log. Avoid entirely during MVP.

### 1.4 No query-param pages in sitemap

Filter/search/map-viewport state may live in the URL (`?attrs=`, `?q=`, `?bbox=`) so views are shareable, but parameterized URLs are **never** listed in `sitemap.xml`, carry `noindex,follow`, and canonicalize to the clean base URL. The sitemap contains only canonical, indexable URLs.

### 1.5 Geo pages — phased rollout

Reserved shape per contract: `/c/:slug/:country` and `/c/:slug/:country/:city`. **Do not build in MVP.**

| Phase | What ships | Eligibility gate | Rationale |
|---|---|---|---|
| **1 (MVP)** | No geo pages. `/c/:slug/:anything` → 404. | — | Too little data; thin doorway pages would poison the domain early. |
| **2** | Country pages `/c/:slug/:country` | **≥ 10 published places** in that country (N = 10) | 10 places supports a unique intro, a top-cities list of ≥ 3, and a real map — not a stub. Below 10 the page is thin content and a doorway-page risk. |
| **3** | City pages `/c/:slug/:country/:city` | **≥ 5 published places** in that city | 5 places = a usable local map + per-place links. Below 5, the category page already serves the intent. |

Rules:
- Country slug = lowercase ISO-3166 English short name (`turkey`, `germany`, `united-states`), derived from `places.country_code` — never free-text.
- City slug = slugified `places.city`, unique within its country (it is nested, so collisions across countries are impossible). Region disambiguation deferred until a real collision exists.
- Eligibility recomputed nightly. A page that drops below threshold gets `noindex` after 30 consecutive days and is removed (301 → parent) after 90 — no thrashing around the boundary.
- Every geo page is **self-canonical** (a country page is distinct content; it must NOT canonical to the category page). `?filter` variants canonical to the clean geo URL.
- Geo pages get the same content-block template as category pages (§5), with the intro/FAQ parameterized by `{country}` / `{city}`.
- hreflang: deferred — MVP is English-only. When i18n lands, add `hreflang` + `x-default`; URL structure already supports it unchanged.

### 1.6 Pagination — not applicable (map UI)

There is no page 2 of a category: places load into the map by **bounding-box viewport**, not by offset. So no `?page=N` URLs, no `rel=next/prev` (deprecated anyway). The crawl path to place pages is instead:
1. `sitemap.xml` — complete, authoritative list of every published place URL;
2. the **indexable HTML block on each category page** (§5), which statically links the top 50 places by `confirm_count` ("Most verified places" list). Every category page therefore links directly to its strongest place pages, and the sitemap guarantees the long tail.

---

## 2. Honest SPA rendering strategy

### 2.1 The honest starting position

The MVP is a **client-rendered React SPA (Vite, no SSR)**. The served `index.html` shell contains almost no content; everything renders in the browser via JavaScript. This means:
- Google indexes via its two-wave process (crawl → render queue). JS content typically indexes **days to weeks later** than static HTML.
- Bing/DuckDuckGo and most social/AI crawlers render JS weakly or not at all.

We accept this deliberately. The MVP's first 1000 users come primarily from **community seeding and direct/shared links** (§8), not from ranking head terms. SSR's cost (server infra, map hydration complexity, slower iteration) is the wrong spend before the core loop is validated.

### 2.2 What is done anyway (MVP crawlability checklist)

All of this ships in the MVP despite the SPA:

1. **Per-route metadata, client-side** — `src/lib/seo.ts` runs on every route change and sets: `document.title`, `<meta name="description">`, `<link rel="canonical">`, `<meta name="robots">` (for noindex states), Open Graph (`og:title/description/url/type/image`) and `twitter:card`. Values per §4.
2. **JSON-LD injected client-side per route** (templates in §3). Google processes injected JSON-LD during rendering.
3. **Dynamic `/sitemap.xml`** from server middleware (contract §6): all categories + all published places, regenerated from the DB with a 1-hour cache. This is the single most important crawlability asset for an SPA — it hands Google every canonical URL without relying on JS-rendered links.
4. **`/robots.txt`** from middleware (§6.3).
5. **Clean URLs** — history-mode routing (no `#`), 301 normalization (§1.1). For MVP the SPA renders a proper "not found" state for unknown slugs; where cheap, the middleware returns a real 404 status for known-dead patterns before serving the shell.
6. **Fast initial load** — Vite code splitting; the map library and tiles load after the shell; category text block renders from the first API response. Target: LCP < 2.5 s on 4G mobile. Core Web Vitals are a ranking input and the map is heavy — keep the SEO text block out of the map's render path.
7. **Indexable category text block rendered in the normal React tree** (§5) — present in the DOM after hydration; crawlable by Googlebot's renderer.

### 2.3 Recommended cheap upgrade (not yet in contract, ~1 dev-day)

**Server-injected per-route `<title>`/meta/OG into the HTML shell by middleware.** The middleware already exists and already serves `/sitemap.xml`; templating `index.html` for `/c/:slug` and `/place/:slug` (lookup by slug → fill title/description/OG/JSON-LD → serve shell) needs no SSR framework and fixes link unfurling (WhatsApp/Telegram/Discord/Slack never run JS) plus non-Google crawlers. **Do this before phase-2 geo pages at the latest; ideally at launch.** The SPA then re-sets the same values client-side on navigation.

### 2.4 Escape hatch A — build-time prerender / static generation

After `vite build`, a script reads the DB and emits one static HTML file per `/c/:slug` and `/place/:slug` into `dist/` (React `renderToString` for the SEO text block + full head metadata + JSON-LD; the SPA hydrates over it on load). Rebuild nightly or on a data-change webhook; place pages tolerate ~24 h staleness because the hydrated app always shows live data.

- **Effort: 3–5 dev-days** + a scheduled rebuild job. No infra change (static files behind the same server).
- **Trigger when any of:** entering geo phase 2; ≥ 5,000 published places; ≥ 30k organic sessions/month; Bing/social traffic shown to matter in GSC/analytics.

### 2.5 Escape hatch B — Next.js App Router migration (identical URLs)

Full SSR/SSG with the React Server Components metadata API. The map stays a client component (`dynamic(..., { ssr: false })`) — only the shell, text blocks, and metadata become server-rendered. URL structure is preserved exactly:

| Current (SPA) | Next.js App Router |
|---|---|
| `/` | `app/page.tsx` |
| `/c/:slug` | `app/c/[slug]/page.tsx` |
| `/place/:slug` | `app/place/[slug]/page.tsx` |
| `/c/:slug/:country` (phase 2) | `app/c/[slug]/[country]/page.tsx` |
| `/c/:slug/:country/:city` (phase 3) | `app/c/[slug]/[country]/[city]/page.tsx` |
| `/add` | `app/add/page.tsx` |
| `/saved` | `app/saved/page.tsx` |
| `/login` | `app/login/page.tsx` |
| `/admin` | `app/admin/page.tsx` |
| `/u/:username` | `app/u/[username]/page.tsx` |
| `/sitemap.xml` (middleware) | `app/sitemap.ts` |
| `/robots.txt` (middleware) | `app/robots.ts` |
| `/api/*` (Node server) | keep as-is as a separate service initially; migrate to route handlers later if convenient |

Because URLs, sitemap, and slugs are unchanged, the migration is **SEO-neutral** (no redirect wave) — the only change is HTML arriving pre-rendered.

- **Effort: 2–3 engineer-weeks** (one engineer), mostly porting pages and re-pointing the API client; map and auth logic carry over.
- **Trigger when any of:** entering geo phase 3; ≥ 100k organic sessions/month; team ≥ 2 engineers; a product need for per-user server rendering appears. If escape hatch A is already live and traffic is growing, B can wait indefinitely.

### 2.6 Decision summary

Launch SPA + §2.2 checklist (+ §2.3 if a day is available) → prerender (A) at phase 2 / 5k places / 30k organic → Next.js (B) only when A is demonstrably insufficient.

---

## 3. JSON-LD structured data

Injected per route client-side (§2.2.2); identical markup moves to the server shell with escape hatch §2.3. **Never emit `aggregateRating` or `review` — Nerde has no ratings, and fabricated review markup risks a manual action.**

### 3.1 Home `/` — WebSite + SearchAction

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Nerde",
  "alternateName": "Nerde.com",
  "url": "https://nerde.com/",
  "description": "Specialized maps for highly specific categories of physical places — calisthenics parks, vanlife spots, arm wrestling clubs and more.",
  "potentialAction": {
    "@type": "SearchAction",
    "target": { "@type": "EntryPoint", "urlTemplate": "https://nerde.com/?q={search_term_string}" },
    "query-input": "required name=search_term_string"
  }
}
```

### 3.2 Category `/c/:slug` — ItemList of Places

Top 50 places by `confirm_count` (same set as the "Most verified places" HTML block, §5):

```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Calisthenics Parks",
  "url": "https://nerde.com/c/calisthenics",
  "numberOfItems": 342,
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "Place",
        "name": "Maçka Calisthenics Park",
        "url": "https://nerde.com/place/macka-calisthenics-park-a3f9",
        "geo": { "@type": "GeoCoordinates", "latitude": 41.047, "longitude": 28.992 }
      }
    }
  ]
}
```

### 3.3 Place `/place/:slug` — Place + GeoCoordinates

```json
{
  "@context": "https://schema.org",
  "@type": "Place",
  "name": "{place.name}",
  "url": "https://nerde.com/place/{slug}",
  "description": "{place.description, max 300 chars}",
  "image": ["https://nerde.com/uploads/{photo1}.jpg"],
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "{address, omit key if empty}",
    "addressLocality": "{city}",
    "addressRegion": "{region, omit if empty}",
    "addressCountry": "{country_code}"
  },
  "geo": { "@type": "GeoCoordinates", "latitude": "{lat}", "longitude": "{lng}" },
  "openingHours": "Mo-Su 00:00-24:00",
  "isAccessibleForFree": true,
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "Pull-up bars", "value": true },
    { "@type": "PropertyValue", "name": "Ground surface", "value": "rubber" }
  ]
}
```

Field rules: `image` omitted when no photos; `openingHours` emitted **only** when `access_24_7=true` (it is the only hours signal we store — do not invent hours); `isAccessibleForFree` only when `free=true`; `additionalProperty` carries the place's resolved category attributes (labels, not raw keys).

### 3.4 FAQ on category pages (optional)

FAQ copy (§5) may carry `FAQPage` markup. Note honestly: since Aug 2023 Google shows FAQ rich results only for well-known authoritative sites — keep it for semantics, expect no rich-result lift at MVP scale.

---

## 4. Metadata templates

Budgets (hard rules, enforced in `src/lib/seo.ts`):
- **Title ≤ 60 chars** (hard stop 65). Place names longer than 40 chars are truncated at a word boundary.
- **Description 140–160 chars** (hard stop 165). No ellipsis stuffing; one CTA maximum.
- Place name is used verbatim (Unicode intact — `Maçka`, not `Macka`) in titles/descriptions; only slugs are transliterated.

| Page | Title template | Example (chars) |
|---|---|---|
| Home `/` | `Nerde — Specialized Maps for Specific Places` | (45) |
| Category | `{Category Name} Near You — Nerde` | `Calisthenics Parks Near You — Nerde` (35) |
| Category, long-name variant (if > 48 chars with suffix) | `{Category Name} — Nerde` | `Climbing / Bouldering — Nerde` (29) |
| Place with city | `{Place Name}, {City} — Nerde` | `Maçka Calisthenics Park, Istanbul — Nerde` (41) |
| Place without city | `{Place Name}, {Country} — Nerde` | `Treptower Park Workout Area, Germany — Nerde` (44) |
| Geo country (phase 2) | `{Category Name} in {Country} — Nerde` | `Calisthenics Parks in Turkey — Nerde` (36) |
| Geo city (phase 3) | `{Category Name} in {City}, {Country} — Nerde` | `Calisthenics Parks in Istanbul, Turkey — Nerde` (46) |

Description templates:

- **Home**: `Where can I find X? Nerde maps the niche places conventional maps miss — calisthenics parks, vanlife spots, arm wrestling clubs, public showers and more.` (157)
- **Category**: `Find {N} {category plural} worldwide. Filter by {top 3 filter labels}. Community-verified, free, updated daily. Top cities: {city1}, {city2}, {city3}.`
  Example: `Find 342 calisthenics parks worldwide. Filter by pull-up bars, lighting, 24/7 access. Community-verified, free, updated daily. Top cities: Istanbul, Berlin, Munich.` (165)
- **Place**: `{Name} — {categories, comma-separated} in {City}, {Country}. {description, first 70 chars}. Verified {x ago} · {n} confirmations.`
  Example: `Maçka Calisthenics Park — Calisthenics Parks in Istanbul, Turkey. Park with pull-up and dip bars near the Bosphorus. Verified 12 days ago · 8 confirmations.` (159)
- **Geo pages**: category description with `{Country}` / `{City}` substituted and the count scoped (`Find 41 calisthenics parks in Turkey. …`).
- Fallbacks: no description → omit the sentence; count below 3 → omit "Top cities"; unverified place → omit "Verified …".

Open Graph / Twitter: `og:title` = title template, `og:description` = description template, `og:url` = canonical, `og:type` = `website` (place pages: `place`), `og:image` = first place photo, else a static branded default (`/og-default.png`, 1200×630). `twitter:card` = `summary_large_image`.

---

## 5. Category landing page content blocks (`/c/:slug`)

Every category page renders this indexable HTML in the normal React tree — **below and around the map**, never behind tabs or accordions. Order on desktop; on mobile the map stays first, text follows. This block is the crawlable substance of the page and the internal-link hub for place pages.

1. **H1 + live count** — `Calisthenics Parks` + `342 places mapped worldwide`.
2. **Intro paragraph** — 60–100 words, hand-written per seed category (unique; never template-spun across categories with only the noun swapped).
3. **Map** (dominant, interactive — unchanged product behavior).
4. **Top cities** — the 8 cities with most places, with counts. Phase 1: plain text (no links — geo pages don't exist yet). Phase 2/3: these become links to country/city pages.
5. **Most verified places** — top 50 by `confirm_count`, linked to `/place/:slug`. This is the static crawl path replacing pagination (§1.6).
6. **Attribute explainer** — the category's filterable attributes, each with a one-line explanation (doubles as filter documentation).
7. **FAQ** — 3–5 genuine Q&As per category.

### 5.1 Template copy — `/c/calisthenics` (ship verbatim)

**H1:** Calisthenics Parks — 342 places mapped worldwide

**Intro:**
> A calisthenics park is an outdoor training area with bars and stations built for bodyweight exercise — pull-ups, dips, muscle-ups, human flags. Also called street workout parks or outdoor gyms, they're usually free and open around the clock, which makes them hard to find on conventional maps that only index commercial gyms. This map collects every calisthenics park the community has verified, worldwide. Zoom to your city, filter by the equipment you need, and tap a marker for photos and details.

**Top cities:** Istanbul (41) · Berlin (28) · Munich (19) · Warsaw (17) · London (15) · Amsterdam (12) · Vienna (11) · Prague (9)
*(counts rendered live from the DB; phase 2 → linked to `/c/calisthenics/turkey` etc.)*

**Attribute explainer:**
> **Pull-up bars** — at least one bar for pull-ups and muscle-ups.
> **Parallel bars** — straight bars for dips and L-sits.
> **Monkey bars** — a horizontal ladder for traversing.
> **Rings** — gymnastic rings, fixed or hanging.
> **Dip bars** — dedicated dip station.
> **Lighting** — usable after dark.
> **Free** — no entry fee or membership.
> **24/7 access** — not locked at night.
> **Ground surface** — rubber, concrete, grass, sand or mixed (matters for falls and handstands).

**FAQ:**
> **Are calisthenics parks free to use?** Almost all are free public installations. Places marked "Free" cost nothing; if a park charges, the listing says so.
> **How do I find a calisthenics park near me?** Tap "Near Me" on the map — your location is used only in your browser and is never stored.
> **Can I train at night?** Filter by "Lighting" and "24/7 access" to see parks that stay open and lit after dark.
> **The park I know is missing — what do I do?** Tap "+ Add Place", drop a pin, and it appears after a quick check. Adding a park takes about a minute.
> **Is the information reliable?** Every listing shows when it was last confirmed by a community member ("Verified 12 days ago") and how many people confirmed it.

Intro/FAQ for the other 17 categories follow the same skeleton, hand-written per category before that category is promoted in seeding campaigns (§8).

---

## 6. sitemap.xml & robots.txt

### 6.1 Included URLs

| URL set | `<lastmod>` source | Priority/changefreq |
|---|---|---|
| `/` | `max(places.updated_at)` | 1.0 / daily |
| All 18 `/c/:slug` | `max(updated_at)` of that category's published places | 0.9 / daily |
| All published `/place/:slug` | `places.updated_at` | 0.6 / weekly |
| Geo pages (phase 2/3, eligible only) | `max(updated_at)` scoped to the geo | 0.7 / weekly |

Excluded: `/add`, `/saved`, `/admin`, `/login`, `/u/:username`, every parameterized URL, removed/pending places. `lastmod` from `places.updated_at` (schema-pinned column) — honest timestamps only; a sitemap full of fake-fresh `lastmod` gets ignored by Google.

### 6.2 Splitting

Hard limits: 50,000 URLs or 50 MB uncompressed per sitemap. At MVP scale one file suffices. When `count(published places) + categories + geo pages > 50,000`:
- `/sitemap.xml` becomes a **sitemap index**;
- children: `/sitemaps/categories.xml`, `/sitemaps/geo-1.xml`, `/sitemaps/places-1.xml` … `places-N.xml` (places chunked at 50k, stable ordering by `places.id` so URLs don't churn between chunks);
- middleware streams children from the same DB query with `LIMIT/OFFSET`.

### 6.3 robots.txt (exact content)

```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: https://nerde.com/sitemap.xml
```

Deliberately **not** disallowed: `/add`, `/saved`, `/login`, `/u/` — blocking them in robots.txt would hide the `noindex` directive from Google (a disallowed page can still enter the index as a bare URL). They are handled by meta robots instead.

### 6.4 noindex rules (thin states)

| State | Directive |
|---|---|
| `/add`, `/saved`, `/login`, `/u/:username` | `noindex,follow` meta robots |
| Filtered/search/bbox views (`?attrs=`, `?q=`, `?bbox=`, `?lat=`, `?lng=`) | `noindex,follow` + canonical to clean base URL |
| Geo page below threshold (§1.5) | `noindex,follow` after 30 consecutive days below threshold; 301 → parent after 90 days |
| Category page with < 3 published places (possible for brand-new categories) | keep indexable — map + intro + FAQ is real content; do NOT publish a new category slug until ≥ 3 seed places exist |
| Place pages `status != published` | never served (404), never in sitemap |

### 6.5 Thin-place sitemap exclusion (added post-review, CRITICAL_REVIEW B1b)

Beyond the §6.1 inclusion rules, `/sitemap.xml` applies a documented thin-content heuristic: a published place is **excluded** from the sitemap when it has **no photos AND an empty description AND a generic fallback name** — where "generic" means the name equals any category name (case-insensitive; this is exactly the importer's `fallbackName`) or matches the constant `^(drinking water|picnic table|bench|viewpoint)$` (case-insensitive), the known OSM-tag fallback labels. Rationale: the OSM import produced ~12k same-named, photo-less, address-less stubs; submitting them risks crawl-budget burn and domain-level quality dampening. Thin places remain fully reachable on the map and at their permanent URLs — this only withholds them from crawler submission until the B1 data-enrichment work (MVP_BACKLOG P1) gives them real content, at which point they re-enter the sitemap automatically (a photo or a description is enough).

---

## 7. Duplicate & thin content prevention

1. **Near-duplicate places** — prevented at write time by the contract duplicate scan (`≤ 100 m` + shared category or name-similar → `409 {duplicates}`). If duplicates slip through, the admin merge picks a winner; the loser's slug 301s to the winner and leaves the sitemap (§1.3). Signals (confirmations, photos, comments) are re-parented to the winner.
2. **One URL per place, ever.** A place in 3 categories still has exactly one `/place/:slug`. Categories are facets, never URL segments — there is no `/c/calisthenics/place/x` variant. This kills the classic multi-category duplicate-URL problem by construction.
3. **City/country page thresholds** — phase 2 ≥ 10 places, phase 3 ≥ 5 (§1.5). Below threshold the URL is a 404, not an empty stub. This is the main defense against the "millions of thin geo pages" failure mode called out in `MASTER_PROMPT.md` §16.
4. **Filtered & search views** — any URL carrying filter/search/viewport params renders `noindex,follow` and canonicalizes to the clean category URL. Both signals point the same way: the clean URL is the only indexable representative. These URLs are never internally linked with `rel` prominence and never appear in the sitemap.
5. **Stale but real places** stay indexed. "Verified 2 years ago · 1 confirmation" is genuine content, not thin content; freshness is surfaced to users, not hidden from crawlers.
6. **New categories** launch only with ≥ 3 seeded places and hand-written intro/FAQ copy (§6.4) — no empty category shells.
7. **Imported OSM places** get the same treatment as community places; the `source`/`source_ref` fields are internal provenance, not visible duplication (no "imported from OSM" boilerplate paragraph repeated on every page — attribution lives once, site-wide, per `DATA_SOURCES.md`).

---

## 8. Organic discovery plan — the first 1000 users

### 8.1 Long-tail queries each category can realistically win

Head terms ("gym near me") are unwinnable. Niche geo-modified long tail is winnable within weeks because the current SERP incumbents are forum threads, dead blogs, and OSM tag lists — no one has a dedicated, structured URL per intent. One dedicated page per `{category} + {city}` intent is exactly what phase-2/3 geo pages provide; phase 1 wins `{category}` and `{category} + {country}` variants via the category page itself.

| Category | Example winnable queries |
|---|---|
| calisthenics | "calisthenics park istanbul", "street workout park berlin", "outdoor pull up bars london", "calisthenics park near me" |
| arm-wrestling | "arm wrestling gym berlin", "arm wrestling club near me", "where to train arm wrestling london" |
| vanlife | "vanlife overnight parking norway", "free overnight parking portugal van", "van parking with water munich" |
| public-showers | "free public showers munich", "public shower near me travel", "shower for van travelers barcelona" |
| overnight-parking | "legal overnight parking germany camper", "sleep in car rest stop france" |
| outdoor-gyms | "outdoor gym amsterdam", "free outdoor gym prague" |
| climbing | "outdoor bouldering amsterdam", "free bouldering wall berlin" |
| drinking-water | "drinking water fountain rome", "refill water bottle lisbon" |
| viewpoints / sunset-spots | "sunset viewpoint lisbon", "best sunset spot istanbul" |
| table-tennis / basketball / skateparks / parkour / swimming-spots / bbq-picnic / photo-spots / powerlifting | same pattern: `{category term} + {city}` and `{free/public/outdoor} + {category term} + near me` |

Prioritization: double down where GSC shows impressions first (§8.4); do not spread seeding thin across all 18.

### 8.2 Community seeding (named targets)

Post as a contributor, not a marketer: one announcement per community, follow each subreddit's self-promotion rules, answer questions in-thread, and add a few places in that community's geography **before** posting. Suggested first wave, matched to the three priority categories:

- **Calisthenics**: r/bodyweightfitness (weekly threads — respect the no-self-promo rule, use the relevant weekly thread), r/streetworkout, r/overcominggravity, city street-workout Facebook groups (e.g. "Street Workout Istanbul/Berlin"), local parkour Discord servers.
- **Arm wrestling**: r/armwrestling, the Armwrestling Discord community, national arm-wrestling federation forums/FB groups (WAF member-country groups).
- **Vanlife**: r/vanlife, r/urbancarliving, r/overlanding, r/digitalnomad (overlap for showers/water), country vanlife Facebook groups (e.g. "Vanlife Germany", "Vanlife Türkiye"), iOverlander/Park4Night community forums — frame Nerde as a complement, not a replacement.
- Second wave: r/bouldering, r/climbing, r/skateboarding, r/tabletennis, r/wildcamping, r/photography (photo-spots angle), city subreddits when a city has strong coverage (post "map of all calisthenics parks in Istanbul" to r/istanbul once Istanbul has 30+ places).
- Product surfaces: a Show HN / relevant Product Hunt launch only after ≥ 3 categories have dense data in ≥ 3 cities each.

**OSM community etiquette (hard rule):** Nerde imports OSM data under ODbL with attribution (see `DATA_SOURCES.md`). Do NOT advertise Nerde in OSM changeset comments, talk pages, or the community forum — that is spam in a volunteer community and would burn the data relationship. The correct give-back is improving OSM itself (adding missing `leisure=fitness_station` etc. tags through normal editing), and mentioning Nerde only if directly asked. Similarly: no drive-by link drops in Reddit/FB — every post adds the data first, links second.

### 8.3 Loops that compound

- **Contributor loop**: place pages are the landing pages from search; every place page shows "+ Add missing place" — searchers in a niche are the best contributors to that niche.
- **Share loop**: every place/category URL unfurls with a proper OG card (§2.3) — one good OG card in a WhatsApp city group outperforms a week of posting.
- **Verification loop**: "Verified N days ago" prompts returning visitors to confirm places, which refreshes `updated_at` → fresher sitemap `lastmod` → better recrawl cadence.

### 8.4 Measurement

- **Google Search Console** — verify the property on day 1 (DNS TXT), submit `https://nerde.com/sitemap.xml` immediately, plus Bing Webmaster Tools (30 minutes, imports GSC). Review weekly:
  - Index coverage: are `/place/*` URLs indexed? SPA rendering delays show up here first (§2.1).
  - Query clusters per category: impressions with CTR < 2 % → rewrite that category's title/description (§4). Zero impressions after 8 weeks → more seed data + community push for that category before writing more copy.
- **Events-table funnel** (contract `events` table, `POST /api/events`): track the chain `search_performed → place_viewed → place_saved → place_submitted`, plus `category_selected`, `filter_applied`, `near_me_used`. Add `referrer_host` into `meta` on the first event of a session (client reads `document.referrer` once) so organic (`google.`, `bing.`, `duckduckgo.`), community (`reddit.`, `facebook.`) and direct traffic are attributable without any third-party tracker.
- **Targets for the first 1000 users**: ~60 % community/direct, ~25 % organic search, ~15 % social shares at the 3-month mark; organic share should be climbing month over month. The contribution signal that matters most (`place_submitted` from users nobody asked) is defined in `MASTER_PROMPT.md` §26 — watch it per category to decide which niche gets the next seeding wave.

### 8.5 Milestones

| Stage | Users | Primary motion |
|---|---|---|
| Launch → month 1 | 0–100 | Direct seeding in 3 priority niches (§8.2); GSC verification; fix indexation blockers |
| Month 1–3 | 100–1000 | Long-tail rankings on priority categories; contributor loop on place pages; trigger §2.3 middleware meta if not done at launch |
| Post-1000 | — | Re-evaluate against escape-hatch triggers (§2.4/§2.5); start geo phase 2 when any category×country crosses 10 places |
