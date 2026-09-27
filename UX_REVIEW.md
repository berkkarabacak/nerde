# Nerde.com — First-Time-User UX Review

**Date:** 2026-09-19 · **Method:** 10 full-page screenshots (desktop 1440×900, mobile 390×844; headless Edge against the production build) **plus a live interactive session** in a real browser (386×858 viewport) driving the actual app: category click → card list → search → place page, with DOM hit-testing of the mobile controls. Production data: 25,296 real places.
**Companion artifact:** [Journey map](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\journey-map.png)

---

## 1. Verdict

The fundamental loop — **choose category → explore map → inspect place → contribute** — works end-to-end in a real browser, and the place page is genuinely good. The weak point is the **first 10 seconds**: at the default world view the map reads empty and the list reads like placeholder data, even though 25k real places are loaded. The product's density is real but invisible at first glance.

## 2. The 5-second test (home, first paint)

[Screenshot: d1-home](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\d1-home.png)

What a visitor sees: a calm Europe-centered map, a search box ("What are you looking for?"), category chips **with live counts** (💪 Calisthenics Parks 370 · 🚐 Vanlife Spots 153 · 🦾 Arm Wrestling 4…), Saved / + Add Place / Log in.

- ✅ The chips + counts do the explaining: this is instantly recognizable as "a map for very specific niches", exactly the §22 goal.
- ✅ No marketing wall, map-first, clean chrome.
- ⚠️ **No tagline.** The one-sentence pitch ("specialized maps for highly specific places… community-editable, built on open data") exists only in the footer of sub-pages. Six words under or beside the search box would close the comprehension gap for non-map-literate visitors.
- ⚠️ **The map looks empty at first paint** — world zoom + skeleton sidebar; the real markers are a 500-place sample scattered across 12 seed cities (see F1).

## 3. Screen-by-screen findings

### 3.1 Category view — [/c/calisthenics](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\d2-category.png)
Live-verified: chip click navigates correctly; 295 cards rendered; filters + Near Me present.
- ⚠️ **Cards are monotonous**: identical "Calisthenics park" names, gray photo placeholders, no city/country on the card. A list of 295 visually identical cards feels like placeholder data even though every row is a real OSM place. (Root cause: imported rows have empty `city` and no photos — backlog P1-11/P1-12.)
- ✅ "Not verified yet — been there?" is a great community prompt on every card.
- ✅ Selected-chip state, Filters, Near me are discoverable.

### 3.2 Place page — [d3-place](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\d3-place.png) · [mobile m2-place](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\m2-place.png)
The strongest screen. Mini-map with marker, category chip, location line, honest sourcing ("Source: curated · location at city level pending community confirmation"), attribute checks (Dedicated club ✓, Regular training ✓, Schedule: Tuesdays 18:30), Save/Directions/Share, ✓ Still there / ⚠ Something's wrong, comments, report. Mobile has a sticky action bar. Live-verified: Save/Verify/Directions all present after navigating from a card.
- ⚠️ "Not verified yet — been there?" appears **twice** (under the title and in the action card).
- ⚠️ No photos anywhere (data gap, not layout gap).

### 3.3 Add Place — [d4-add](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\d4-add.png)
Clean 5-step wizard; step 1 = drag-pin map with live coordinates + Confirm location; guest submission allowed.
- ⚠️ Pin defaults to Istanbul regardless of where the user is; no "use my location" or place-search on this step.

### 3.4 Login / Saved — [d5-login](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\d5-login.png) · [d6-saved](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\d6-saved.png)
Good microcopy ("Save places, add new ones, and verify what's still there." / "Log in to see your saved places."). Sign-in/up tabs. No issues.

### 3.5 Sparse category — [d7-empty-cat (sunset-spots)](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\d7-empty-cat.png)
One demo place; marker renders on the map. Empty-ish categories stay honest (count badges show 1–4) instead of pretending.

### 3.6 Mobile home — [m1-home](C:\Users\OdinLocal\Documents\Kimi\Workspaces\NeNerde\app\verification\ux\m1-home.png)
Full-bleed map, floating search, category pills, bottom sheet. **FABs (Near Me, + Add) did not paint in headless captures — investigated: DOM contains them, CSS compiles, and a real-browser hit-test proves the + Add FAB is visible and clickable at (303, 642) on a 386-px viewport.** Headless-only artifact; no code bug. Near Me self-hides when the geolocation API is unavailable (correct degradation).
- ⚠️ Bottom-sheet peek label "**0 places nearby**" is misleading at world view (it means "in current map view", and at first paint the query hasn't landed). On the category page it said "245 places nearby" — same label issue.

## 4. Findings (severity-ordered)

| # | Sev | Finding | Suggested fix |
|---|---|---|---|
| F1 | **High** | First paint reads empty: world zoom + 500-sample scatter hides the 25k places | Default the map to the densest data region (or fit-bounds to data); consider city quick-links ("Istanbul · Berlin · NYC") |
| F2 | **High** | Identical generic card names + no city + gray thumbs = "placeholder data" vibe | Show city/country on cards (backfill `city` from import bbox at import time — cheap); photo enrichment (already P1-11) |
| F3 | Med | "N places nearby" is really "in view"; wrong at world view | Rename to "in this area", or only show after Near Me |
| F4 | Med | No tagline on home | Add one line near the search bar |
| F5 | Med | Duplicate verification prompt on place page | Keep one |
| F6 | Low | Add wizard starts at Istanbul for everyone | Prefill from Near Me / last map position |
| F7 | Low | Truncated demo names on narrow cards ("Community demo sunset point (Ist…") | Shorter demo names |
| F8 | Note | Headless captures under-paint markers/FABs | Not a product bug — verified live; don't trust headless pixel diffs for this app |

## 5. What already delights

- Category chips with live counts — the whole pitch in one row.
- Verification as a first-class citizen ("Still there / Something's wrong", "been there?") — unique vs Google Maps.
- Honest sourcing on every place (OSM vs curated vs community) builds trust.
- Guest add-place with duplicate detection — contribution without account friction.
- Search understands categories AND places ("vanlife" → category + places, live-tested).

## 6. One-line summary

> A first-time user understands the product in 5 seconds from the category chips, but the empty-looking first map view and placeholder-feeling list cards hide the 25k real places — fix the first paint (F1/F2) and the first impression matches the real depth.
