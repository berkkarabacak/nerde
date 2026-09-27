# Nerde.com — Validation Launch Kit

**Purpose:** get the MVP in front of its first real users and measure the one hypothesis that matters (MASTER_PROMPT §4/§26): *people want a map for highly specific places, and some will contribute locations themselves.*

**What the product is today — honestly:**

- 25,317 real places across **12 cities** (Istanbul, Berlin, Barcelona, Munich, London, Amsterdam, New York, San Francisco, Los Angeles, Sydney, Tokyo, São Paulo). Outside those cities the map is empty — Near Me returns nothing for most of the planet. Say so when asked; never imply otherwise.
- Depth is uneven: calisthenics 370, public-showers 749, vanlife 152, arm-wrestling **4 (hand-curated)**. Place pages are genuinely good (verification status, resolved attributes, sourcing) but photos are still thin and some imported names are generic — enrichment is mid-flight (MVP_BACKLOG P1-11).
- The loop works end-to-end: browse → filter → open place → save → add (guest-OK) → verify → report. It is free, built on OpenStreetMap data (ODbL, attribution in the UI), and community-editable without an account for adds.

Launch is a **validation experiment**, not a growth push. Success = the funnel numbers below move; anything else is noise.

---

## 1. Pre-launch checklist

Do these in order; each is verifiable before moving on.

- [ ] **1. Change the seeded admin password.** The seed creates the admin only if none exists, using `NERDE_ADMIN_PASSWORD` from `.env` (default `nerde-admin-2026` is publicly documented — CRITICAL_REVIEW I4). On a fresh deploy: set a strong value in `.env` *before* `npm run seed`. On an already-seeded DB: update the admin row directly, e.g.
  ```bash
  sqlite3 db/nerde.sqlite "UPDATE users SET password_hash='<new scrypt hash>' WHERE role='admin';"
  ```
  (generate the hash via the app's auth module, or delete the admin user and re-run `npm run seed` with the new env set). Verify: log in at `/login` with the new password; confirm the old one fails.
- [ ] **2. Set `NERDE_TRUST_PROXY=1`** — only when the server actually runs behind a reverse proxy (nginx/Caddy/ALB) that sets `X-Forwarded-For`. Without it, rate limiting keys on the socket address (safe default); with a proxy and *without* this flag, every user shares one rate-limit bucket; without a proxy and *with* it, the limiter is spoofable. Verify: `grep NERDE_TRUST_PROXY .env` matches the real topology.
- [ ] **3. Google sign-in (optional, env-gated).** The OAuth feature ships disabled unless `NERDE_GOOGLE_CLIENT_ID` and `NERDE_GOOGLE_CLIENT_SECRET` are set. Either set both (from Google Cloud Console → OAuth 2.0 credentials, authorized origin `https://nerde.com`) or leave both unset and launch email-only. Do not set one without the other.
- [ ] **4. Backups for `db/` + `public/uploads/`.** Community-contributed places and photos are the only data that cannot be re-imported (CRITICAL_REVIEW L2). Cron example (nightly 03:17, keeps 14 days):
  ```cron
  17 3 * * * sqlite3 /srv/nerde/app/db/nerde.sqlite ".backup '/srv/nerde/backups/nerde-$(date +\%F).sqlite'" && tar -czf /srv/nerde/backups/uploads-$(date +\%F).tar.gz -C /srv/nerde/app public/uploads && find /srv/nerde/backups -mtime +14 -delete
  ```
  Copy the backup dir off-box (any object storage). Verify: run the commands once by hand, then **restore one backup to a scratch dir and boot against it** — an untested backup is not a backup.
- [ ] **5. Set `NERDE_BASE_URL=https://nerde.com`.** It drives the absolute URLs in `/sitemap.xml`, `/robots.txt`, and canonical/OG tags (server/routes/seo.ts). Wrong value = sitemap full of staging URLs.
- [ ] **6. Verify `/robots.txt` + `/sitemap.xml` on the public domain.**
  ```bash
  curl -s https://nerde.com/robots.txt
  curl -s https://nerde.com/sitemap.xml | head -40
  ```
  Expect: robots allows crawling with a `Sitemap:` line; sitemap lists `/`, all `/c/*` category pages, and published non-thin place URLs (thin stubs are intentionally excluded, SEO_STRATEGY §6.5). Spot-check one place URL from the sitemap renders.
- [ ] **7. Submit the sitemap to Google Search Console.** Verify the property (DNS TXT), submit `https://nerde.com/sitemap.xml`, then import the property into Bing Webmaster Tools (30 min, imports from GSC). Weekly review cadence starts day 1 (SEO_STRATEGY §8.4).
- [ ] **8. Quick Lighthouse run** (mobile preset, incognito): `/`, `/c/calisthenics`, one `/place/*` URL. Record Performance/Accessibility/SEO scores in a comment on the launch PR. Fix genuine errors (console errors, missing alt, broken meta); ignore vanity points — per-route meta and sitemap are already the SEO substance (SEO_STRATEGY §2).
- [ ] **9. Final walkthrough on the production domain**: the 17-step DoD walkthrough (MVP_BACKLOG release checklist) on desktop + a real phone, and spot-check that all 10 analytics event types land in `events` (then confirm they show up in **/admin → Funnel**).

---

## 2. Community seeding plan

Rules that apply to every post below (from SEO_STRATEGY §8.2 — read it first):

- Post as a **contributor, not a marketer**: one announcement per community, in the correct thread where self-promo is restricted, and answer every question in-thread.
- **Add data before posting**: contribute 3–5 places in that community's geography *before* the post goes up, so the link shows value immediately.
- **One post per community, ever, for launch.** Follow-up only if the community engages.
- **OSM channels are off-limits for promotion** (hard rule, SEO_STRATEGY §8.2): give back by improving OSM tags through normal editing, never by advertising Nerde in changesets or forums.

### 2.1 r/bodyweightfitness — calisthenics (post in the weekly thread; self-promo rule is strict)

> **Title:** Free map of calisthenics parks in 12 cities — built on OpenStreetMap, community-editable
>
> Hey all — I built Nerde (nerde.com), a free, map-first site for highly specific places that mainstream maps handle badly. The calisthenics layer currently maps ~370 parks with pull-up and parallel bars across 12 cities (Istanbul, Berlin, London, Barcelona, Munich, Amsterdam, NYC, SF, LA, Sydney, Tokyo, São Paulo), filterable by things like free access and 24/7.
>
> Data comes from OpenStreetMap plus community edits. Anyone can add a missing park without an account, or confirm a place still exists — that's how the data stays fresh.
>
> Link: nerde.com/c/calisthenics
>
> One ask: if a park you train at is missing or wrong, add it or flag it. I'll be here in the comments for questions. (Posting in the weekly thread to respect the self-promo rules — mods, happy to adjust if needed.)

### 2.2 r/streetworkout — calisthenics (smaller sub; still check rules and engage)

> **Title:** Map of street workout parks (370 spots, 12 cities) — free, OSM-based, editable by anyone
>
> Hi r/streetworkout — I'm building Nerde (nerde.com), a free map for the places big map apps ignore. The street workout / calisthenics layer has ~370 parks across 12 cities so far — Istanbul, Berlin, London, Barcelona, Munich, Amsterdam, New York, San Francisco, Los Angeles, Sydney, Tokyo, São Paulo — with filters for pull-up bars, dip stations, free access, and 24/7.
>
> Everything sits on OpenStreetMap data and is community-editable: no account needed to add a missing park, and one tap confirms a place still exists.
>
> Map: nerde.com/c/calisthenics
>
> The one thing that would actually help: add one park you train at that's missing, or correct one that's wrong. I'll hang out in the comments. I checked the sub rules before posting — if this breaks them, mods, just remove it, no hard feelings.

### 2.3 r/armwrestling — arm-wrestling (honest about having only 4 entries; this is a recruitment post)

> **Title:** I started a map of arm-wrestling clubs — it has 4 entries and needs your help
>
> Hey r/armwrestling — quick honest one. I'm building Nerde (nerde.com), a free map for niche physical places, and arm wrestling is one of the priority categories. Problem: the scene is basically invisible online, so after my own research the map has exactly 4 curated clubs. That's embarrassing, and it's why I'm posting.
>
> The map is free, built on OpenStreetMap data, and community-editable — anyone can add a club or training gym without making an account, and existing entries can be confirmed or flagged as wrong.
>
> Link: nerde.com/c/arm-wrestling
>
> My one ask: add your club. Name, location, training nights if you know them — done in two minutes. If the 4 entries grow to 40, this becomes genuinely useful for anyone searching "arm wrestling near me". Questions welcome in the comments; I read the self-promotion rules and hope this passes as a community resource, not an ad.

### 2.4 r/vanlife — vanlife + public-showers (respect spot-sensitivity; only public OSM data)

> **Title:** Free map of vanlife-friendly overnight spots + public showers (OSM-based, editable)
>
> Hi r/vanlife — I built Nerde (nerde.com), a free map for places vanlifers actually search for: overnight parking (152 spots so far) and public showers (749), filterable by free access, drinking water, toilets, and 24/7. Coverage today is 12 cities — Istanbul, Berlin, Barcelona, Munich, London, Amsterdam, NYC, SF, LA, Sydney, Tokyo, São Paulo.
>
> Everything comes from public OpenStreetMap data plus community edits — no secret spots get exposed that aren't already public data, and anyone can add or correct an entry without an account. "Verified N days ago" labels show how fresh each spot is.
>
> Map: nerde.com/c/vanlife (showers: nerde.com/c/public-showers)
>
> One ask: next time you stay somewhere on the map, tap "still there" — or add one spot that's missing. Fresh confirmations are the whole point. I'll answer questions here; checked the sub's rules before posting.

### 2.5 r/climbing — climbing (thin coverage; frame as help-wanted, not product launch)

> **Title:** Free map of outdoor bouldering walls & climbing spots — thin so far, help me fix it
>
> Hey r/climbing — I'm building Nerde (nerde.com), a free, map-first site for niche physical places. Outdoor climbing and bouldering walls are on it, but I'll be honest: coverage is thin so far — a handful of spots across 12 cities, pulled from OpenStreetMap. The calisthenics and vanlife layers are already dense; climbing is the one that needs the community most.
>
> The map is free and community-editable: anyone can add an outdoor wall, free bouldering spot, or crag approach without an account, and one tap confirms a place still exists so data doesn't rot.
>
> Link: nerde.com/c/climbing
>
> One ask: add one outdoor spot you know that's missing — two minutes, no sign-up. If this sub fills in even one city properly, the page becomes worth bookmarking. I'll be in the comments. Read the self-promo rules first — mods, remove if this doesn't fit.

### 2.6 Local Facebook groups / Discord servers (generic guidance — adapt, don't paste)

Targets: city street-workout FB groups (e.g. "Street Workout Istanbul", "Street Workout Berlin"), country vanlife groups ("Vanlife Germany", "Vanlife Türkiye"), local climbing/parkour Discord servers. One group per geography you just enriched.

Adaptable template (rewrite in your voice; groups smell copy-paste):

> Hey [group] — I built a free map of [category] spots and [city] is one of the covered cities: nerde.com/c/[slug]. It's built on OpenStreetMap data and anyone can add or correct places without an account. If your local spot is missing, adding it takes two minutes. Happy to answer questions here.

Group-specific rules: message the admin/mod first where the group requires it; post only after adding 3–5 local places; stay in the thread and reply to every comment; one group per evening, not a blast.

### 2.7 Do-NOT list

- **Don't mass-post.** One community per day maximum; identical text across subs on the same day is a spam pattern and mods coordinate.
- **Don't astroturf.** No second accounts, no "found this cool site" posts, no upvote asks. If it can't win on honesty, the hypothesis fails honestly.
- **Don't claim coverage we don't have.** Density exists only in **Istanbul, Berlin, Barcelona, Munich, London, Amsterdam, New York, San Francisco, Los Angeles, Sydney, Tokyo, and São Paulo**. Anywhere else, say "thin so far — add yours."
- **Don't crosspost** (Reddit's crosspost feature) launch posts; tailor per community instead.
- **Don't promote in OSM channels** — changeset comments, talk pages, the OSM forum. Give back by improving OSM tags (SEO_STRATEGY §8.2 hard rule).
- **Don't post to city subreddits** (r/istanbul, r/berlin) until that city has 30+ places in the posted category (SEO_STRATEGY §8.2).
- **Don't argue with mods.** A removal is final for launch; log it and move on.
- **Don't launch on Show HN / Product Hunt** until ≥3 categories are dense in ≥3 cities each (SEO_STRATEGY §8.2).

---

## 3. Measurement plan

**Where the numbers live:** `/admin` → **Funnel** tab (7/30-day toggle: ordered funnel bars with step conversion, other-event counts, unique visitors, 14-day contribution trend), backed by `GET /api/admin/funnel`. Source attribution comes from `referrer_host` in event meta (reddit. / google. / direct) — SEO_STRATEGY §8.4. Google Search Console covers query impressions/CTR.

Review **weekly, same weekday**. Baselines are set in week 1; ranges below are starting hypotheses to calibrate, not industry facts (PRODUCT_SPEC §7: "baseline set week 1; target direction: rising").

| Funnel step (events) | Question (§26) | Healthy range to watch | If below range |
|---|---|---|---|
| `search_performed` → `place_viewed` | Are results worth opening? | ~25–45% | <15% after week 2 → place pages not paying off (thin photos/names) or wrong-intent traffic; fix content before more seeding |
| `place_viewed` → `place_saved` | Useful enough to keep? | ~3–8 saves per 100 views (account-gated, so absolutes stay small) | ~0 with real views → value prop unclear; check which categories get views without saves |
| `add_place_started` → `place_submitted` | Is the flow too heavy? | ~40–60% completion | <25% → walk the 5-step flow yourself; find the drop-off step |
| unique visitors → `place_submitted` | **The §26 hypothesis** | ~0.2–1% early; **any unsolicited submission is the strongest signal** | The kill/pivot table below |
| `place_verified` per week | Data freshness loop alive? | Any steady non-zero, rising week-over-week | Flat zero → verification prompts may be invisible; check place-page UX |
| Returning visitors (client_ids active ≥2 days/week) | Do people come back? | ≥10% of weekly actives | <5% → utility isn't repeatable yet (density problem, not marketing problem) |

Also watch weekly: funnel counts **per category** (events carry `meta.cat`) to decide which niche gets the next seeding wave (SEO_STRATEGY §8.4), and GSC impressions for the §8.1 long-tail queries.

**"Validated" signals after 2–4 weeks** (any two = double down on that niche with the next seed wave + geo pages, MVP_BACKLOG P1-09/P2-04):

1. ≥1 `place_submitted` from a user nobody asked (the §26 headline signal).
2. Search → view conversion ≥25% and not falling.
3. ≥10% of weekly visitors returning on ≥2 days.
4. GSC impressions on priority-category queries climbing week over week.

**"Kill/pivot" signals after 2–4 weeks** (any one = stop and reassess, don't add features):

1. Zero organic submissions after 3 community waves + 4 weeks → contribution hypothesis fails; pivot toward read-only utility or a single-niche focus.
2. Search → view <10% even after P1-11 enrichment lands → the payoff page itself fails; fix data quality or reposition.
3. Threads get upvotes/comments but the funnel shows no downstream add/verify → "nice to have" demand; try the one category with the best per-capita contribution before writing the whole thing off.

---

## 4. Rollback & risk notes

- **OSM tile policy (most likely total-outage cause, CRITICAL_REVIEW I5).** Map tiles come from `tile.openstreetmap.org`, whose usage policy covers light use only. Switch triggers: tile 403/429s in browser consoles, visibly gray map areas, or a sustained spike (rough guide: >~5k map sessions/day or a front-page moment on HN/Reddit). Response: move to a low-cost hosted raster provider (keep the "© OpenStreetMap contributors" attribution — data license is unaffected by tile host), and keep OSM as documented fallback; self-hosted vector tiles stay P2-08.
- **Overpass dependency = freshness risk, not uptime risk.** OSM imports run as batch scripts (`npm run import:osm`), never in the request path. If Overpass is down, an import fails and nothing user-facing breaks — retry later. Re-run imports monthly per city (or cron) to keep data fresh; the importer fails over across endpoints and is idempotent via `source_ref`.
- **Nominatim geocoding** is called from the browser (search + add-flow) on volunteer infrastructure; if throttled, move it behind a same-origin `/api/geocode` proxy with server-side caching (CRITICAL_REVIEW I5).
- **Moderation queue discipline.** Submissions publish instantly (reactive model, PRODUCT_SPEC §8.3) — the guardrails are validation, honeypot, rate limits, and the report queue. During launch weeks: check `/admin` → **Reports** at least weekly (daily is better while a thread is live), empty the open queue, and glance at `public/uploads/` size for abuse. Unmoderated spam in week 1 teaches the first cohort the wrong lesson.
- **Rollback of the launch itself** is cheap: the site is static + SQLite on one box. Worst case, set the seeded categories back to a private/staging domain, restore the last nightly backup (§1.4), and relaunch after fixes. No irreversible step exists in this plan except burning community goodwill — which is what §2.7 protects.

---

*Sources: [MASTER_PROMPT.md](MASTER_PROMPT.md) §25–§27, [PRODUCT_SPEC.md](PRODUCT_SPEC.md) §2/§7/§8, [SEO_STRATEGY.md](SEO_STRATEGY.md) §8, [CRITICAL_REVIEW.md](CRITICAL_REVIEW.md) B1/B3/I4/I5/L2, [MVP_BACKLOG.md](MVP_BACKLOG.md) release checklist + P1-11 status, [UX_REVIEW.md](UX_REVIEW.md) §5–§6. Place counts as of this writing; re-check the live DB before quoting numbers in a post.*
