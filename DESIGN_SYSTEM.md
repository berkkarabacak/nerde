# Nerde.com — Design System (MVP)

**Owner:** UX/UI Designer agent · **Consumers:** Frontend agent (builds directly from this doc with Tailwind 3.4 + shadcn/ui), QA agent (acceptance criteria)
**Constraints:** React 18 + TS + Vite, Tailwind 3.4, shadcn/ui (pre-installed in `app/src/components/ui/`), MapLibre GL JS + OSM raster tiles, light theme only, **no custom CSS framework** — Tailwind utilities + shadcn components + a small set of CSS custom properties for markers.

---

## 1. Design Principles

1. **The map is the product.** Map canvas occupies the maximum possible viewport area on every breakpoint. Chrome (headers, panels, buttons) is flat, minimal, and never competes with map content for attention.
2. **Five-second comprehension.** First-time visitors see: a map full of emoji markers, a search bar saying "What are you looking for?", and category chips with words like "Calisthenics" and "Vanlife". No explanation needed. No marketing hero, no scroll gate.
3. **Modern, minimal, fast, geographic, community-driven, trustworthy** (per MASTER_PROMPT §22). Every visual choice must serve one of those words or be removed.
4. **Hard prohibitions** (from §22):
   - No gradients (buttons, backgrounds, overlays — none).
   - No glassmorphism / backdrop-blur frosted panels. Panels are solid white with a 1px border and a modest shadow.
   - No "AI-looking" effects: no glowing borders, no animated shimmer gradients, no neon accents.
   - No decorative animation. Animation exists only for state feedback (sheet slide-in, skeleton pulse, toast appear, marker press feedback) and uses ≤200ms ease-out.
   - No illustrations, mascots, or stock imagery. Category emoji carry the visual personality.
5. **Flat + geographic.** The visual signature is: white UI, one ink color, one accent, category-colored round markers with emoji. The map tiles provide all the texture the product needs.
6. **Density over decoration.** Prefer showing more places/filters in less space to adding visual flair.
7. **Mobile is a separate design, not a shrink.** Desktop = sidebar + map. Mobile = full-bleed map + floating controls + bottom sheet (§21).
8. **Accessible by default.** Color is never the only indicator; every icon-only button has an `aria-label`; touch targets ≥ 44px; visible focus rings everywhere (see §11).

---

## 2. Color System (light theme only)

### 2.1 Core palette (Tailwind classes)

| Role | Tailwind token | Hex | Usage |
|---|---|---|---|
| Page background | `bg-neutral-50` | `#FAFAFA` | App background behind panels (rarely visible; map covers it) |
| Surface / panel | `bg-white` | `#FFFFFF` | Sidebar, cards, sheets, dialogs, popovers |
| Border | `border-neutral-200` | `#E5E5E5` | Panel borders, dividers, input borders |
| Primary text | `text-neutral-900` | `#171717` | Headings, place names, body emphasis |
| Secondary text | `text-neutral-600` | `#525252` | Addresses, metadata, descriptions |
| Muted text | `text-neutral-400` | `#A3A3A3` | Placeholders, "N days ago", disabled |
| **Accent (brand)** | `bg-blue-600` / `text-blue-600` | `#2563EB` | Primary buttons, active chip, links, selected states, near-me button. Matches `categories.color` default in CONTRACTS §5 |
| Accent hover | `bg-blue-700` | `#1D4ED8` | Primary button hover |
| Success | `text-emerald-600` / `bg-emerald-600` | `#059669` | "✓ Still there", verified badge, success toast |
| Warning | `text-amber-600` / `bg-amber-500` | `#D97706` / `#F59E0B` | "⚠ Something's wrong", stale-verification hints |
| Danger | `text-red-600` / `bg-red-600` | `#DC2626` | Destructive actions, report, error states |
| Cluster badge | `bg-blue-600` | `#2563EB` | Marker cluster circle (see §5.3) |

This maps cleanly onto the default shadcn/ui CSS-variable theme (`--primary: 221 83% 53%` ≈ blue-600). Configure `app/src/index.css` with the standard shadcn light theme, setting primary to blue-600, radius `0.5rem`. No dark theme variables needed for MVP.

### 2.2 Rules

- One accent only (blue-600). Category colors appear **only** on map markers and small category dots/chips — never as page backgrounds or button fills.
- Semantic colors (success/warning/danger) appear only in their semantic contexts.
- Text on map (popup cards) always sits on solid white.

---

## 3. Typography

System stack (fast, no webfont download): `font-sans` = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` (Tailwind default — do not add a webfont for MVP).

| Element | Classes | Size/Weight |
|---|---|---|
| Page title (place name, page H1) | `text-xl font-semibold text-neutral-900` | 20px / 600 |
| Section heading (e.g. "Filters", "Photos") | `text-sm font-semibold text-neutral-900` | 14px / 600 |
| Card title (list items, preview card) | `text-sm font-medium text-neutral-900` | 14px / 500 |
| Body | `text-sm text-neutral-600` | 14px / 400 |
| Small metadata (address, distance, "Verified N days ago") | `text-xs text-neutral-500` | 12px / 400 |
| Micro / captions, badge counts | `text-[11px] font-medium` | 11px / 500 |
| Search input | `text-sm` | 14px — never below 16px on mobile inputs to avoid iOS zoom: use `text-base` (16px) inside mobile search inputs |
| Buttons | `text-sm font-medium` | 14px / 500 |

Emoji icons render at native size (`text-base`–`text-xl` depending on context); never recolor emoji.

## 4. Spacing, Radius, Shadow, Z-Index

**Spacing scale (Tailwind):** use `1, 1.5, 2, 3, 4, 6, 8` only. Standard panel padding `p-4`; card padding `p-3`; chip padding `px-3 py-1.5`; section gaps `space-y-4`; inline icon+text gap `gap-1.5`/`gap-2`.

**Radius:** `rounded-md` (6px) inputs/buttons; `rounded-lg` (8px) cards/panels; `rounded-full` chips, markers, FABs, avatars.

**Shadow (flat system, one level each):**
- Floating controls / FABs: `shadow-md`
- Bottom sheet / sidebar / dialogs: `shadow-lg`
- Popovers/dropdowns: `shadow-md border border-neutral-200`
- Never use `shadow-2xl` or colored shadows.

**Z-index layers (Tailwind arbitrary values, MapLibre canvas is z-0):**

| Layer | Class |
|---|---|
| Map canvas | `z-0` |
| Floating buttons, search bar | `z-10` |
| Bottom sheet (mobile) / sidebar (desktop) | `z-20` |
| Dropdowns, popovers, command palette | `z-30` |
| Dialogs, drawers | `z-40` (shadcn overlay default) |
| Toasts (sonner) | `z-50` (sonner default) |

---

## 5. Category Visual Language

### 5.1 The 18 categories: emoji + marker color

Palette goals: 18 distinguishable hues, grouped by `grp` (fitness = warm/energetic family, outdoor = cool/nature family) so the map reads coherently at a glance; all fill colors achieve ≥3:1 contrast against typical OSM light map background (#F2EFE9-ish) and against the white marker ring; white emoji sits on top. Hex values are stored in `categories.color` (CONTRACTS §5 — backend seeds these exact values).

**Group `fitness` (warm spectrum):**

| # | Slug | Icon | Name | Marker hex |
|---|---|---|---|---|
| 1 | `calisthenics` | 💪 | Calisthenics Parks | `#DC2626` red-600 |
| 2 | `arm-wrestling` | 🦾 | Arm Wrestling | `#EA580C` orange-600 |
| 3 | `outdoor-gyms` | 🏋️ | Outdoor Gyms | `#D97706` amber-600 |
| 4 | `powerlifting` | 🏋️‍♂️ | Powerlifting Gyms | `#B45309` amber-700 |
| 5 | `climbing` | 🧗 | Climbing / Bouldering | `#9A3412` orange-800 |
| 6 | `skateparks` | 🛹 | Skateparks | `#65A30D` lime-600 |
| 7 | `parkour` | 🤸 | Parkour Spots | `#16A34A` green-600 |
| 8 | `basketball` | 🏀 | Basketball Courts | `#F97316` orange-500 |
| 9 | `table-tennis` | 🏓 | Public Table Tennis | `#0D9488` teal-600 |

**Group `outdoor` (cool spectrum):**

| # | Slug | Icon | Name | Marker hex |
|---|---|---|---|---|
| 10 | `vanlife` | 🚐 | Vanlife Spots | `#2563EB` blue-600 |
| 11 | `overnight-parking` | 🅿️ | Overnight Parking | `#4F46E5` indigo-600 |
| 12 | `public-showers` | 🚿 | Public Showers | `#0891B2` cyan-600 |
| 13 | `drinking-water` | ⛲ | Drinking Water | `#0284C7` sky-600 |
| 14 | `bbq-picnic` | 🍖 | BBQ & Picnic Areas | `#C2410C` orange-700 |
| 15 | `swimming-spots` | 🏊 | Swimming Spots | `#06B6D4` cyan-500 |
| 16 | `viewpoints` | 🌄 | Viewpoints | `#7C3AED` violet-600 |
| 17 | `sunset-spots` | 🌇 | Sunset Spots | `#DB2777` pink-600 |
| 18 | `photo-spots` | 📷 | Photography Spots | `#9333EA` purple-600 |

Fallback/uncategorized: `#475569` slate-600 (📍).

**Multi-category places:** marker uses the color of the **first** category in the place's `categories[]` array (server returns them sorted by category `sort`). The preview card shows all category chips, so no information is lost. Do not build multi-color split markers for MVP.

### 5.2 Marker anatomy

HTML markers (`new maplibregl.Marker({element})`), not a symbol layer — emoji rendering is free and accessible:

```
Size: 32px circle (w-8 h-8)
Fill: category color (2.1)
Ring: 2px solid white (ring-2 ring-white) → separation from any basemap
Emoji: 16px, centered
Shadow: shadow-md
Cursor: pointer
```

- **Hover (desktop):** `scale-110` transform, 150ms ease-out. 
- **Selected marker:** ring becomes `ring-blue-600` (2px white + outer 2px blue via `box-shadow: 0 0 0 2px #fff, 0 0 0 4px #2563EB` — this box-shadow string is the single sanctioned piece of custom CSS, put it in `index.css` as `.marker-selected`).
- **Near-me user dot:** 16px `bg-blue-600` circle, 2px white ring, plus a 32px `bg-blue-600/20` pulse disc behind it (single subtle pulse animation allowed — it is state feedback, not decoration).
- Markers must have `role="button"` and `aria-label={place.name}` (or the wrapper must; emoji alone is not an accessible name).

### 5.3 Cluster badge styling

MapLibre GeoJSON `cluster: true` with a circle layer:

```
Circle fill: #2563EB (blue-600), opacity 1
White 2px stroke
Count label: white, 12px, font-medium, tabular-nums
Radius steps: <10 places → 16px; 10–49 → 20px; 50+ → 24px
```

Clusters are category-agnostic (blue) on purpose: they read as "zoom in for more", not as data. Clicking a cluster zooms to its expansion zoom (MapLibre default behavior). At world zoom levels where multiple categories mix, a blue cluster reads neutrally; once zoomed past cluster threshold, category colors take over.

### 5.4 Category chips (filter/select contexts)

- **Unselected chip:** `bg-white border border-neutral-200 text-neutral-700` → `emoji + name`, e.g. `💪 Calisthenics`.
- **Selected chip (filter bar):** small filled dot in category color + `bg-neutral-900 text-white`? **No —** simpler rule: selected = `border-2` in the category color + solid white bg + 6px colored dot before emoji. Never fill a whole chip with a category color (18 colored blobs would wreck visual calm).
- **Selected chip in the top search/category rail (single active category):** `bg-neutral-900 text-white` with emoji — the strongest "this map is filtered" signal, and it is category-color-independent so it stays readable. The category dot is shown next to it.
- **On place cards:** `inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs` with emoji only + name. Category color appears as a 6px dot (`style={{background: color}}`) before the emoji.

---

## 6. Layouts (ASCII wireframes)

Breakpoints: mobile `< 768px` (Tailwind `md` below this = mobile design), desktop `≥ 768px`. The two layouts are **different components** (`<MapHomeDesktop/>` / `<MapHomeMobile/>` chosen by a `useMediaQuery('(min-width: 768px)')` hook), sharing map state.

### 6.1 Desktop map home (`/` and `/c/:slug`, ≥768px)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🗺️ nerde   ┌───────────────────────────────────┐  [♡ Saved] [👤/Log in]│  ← top bar, 56px, bg-white, border-b
│  (logo)    │ 🔍 What are you looking for?      │  [+ Add Place]      │     search input centered, max-w-xl
├────────────┴───────────────────────────────────┴─────────────────────┤
│ Active category rail (h-11, bg-white, border-b, horizontal scroll):   │
│ [All] [💪 Calisthenics] [🦾 Arm Wrestling] [🏋️ Outdoor Gyms] [🚐 …▸]  │
├──────────────┬───────────────────────────────────────────────────────┤
│              │                                                       │
│  SIDEBAR     │                 MAP (fills remaining)                  │
│  360px       │                                                       │
│  bg-white    │      📍32px emoji markers + 🔵 clusters                │
│  border-r    │                                                       │
│              │                                        ┌───────────┐  │
│ ┌──────────┐ │                                        │ 🎛 Filters│  │ ← floating, top-right of map
│ │Filters ▾ │ │  (active filter chips row under it)    └───────────┘  │
│ └──────────┘ │                                        ┌───────────┐  │
│ ┌──────────┐ │                                        │  📍 Near  │  │ ← floating, right side
│ │ PlaceCard│ │                                        │    me     │  │   above zoom controls
│ │ 💪 Maçka │ │                                        └───────────┘  │
│ │ Calisth..│ │                                     [+]  zoom ctrls   │
│ │ 1.2 km · │ │                                     [−]  bottom-right │
│ │ ✓ 12d ago│ │                                                       │
│ ├──────────┤ │   © OpenStreetMap contributors  (bottom-left,        │
│ │ PlaceCard│ │    text-[11px], required attribution)                │
│ │ ...      │ │                                                       │
│ └──────────┘ │        ┌──────────────────────┐                      │
│  (scroll)    │        │ Preview card on      │ ← marker click,      │
│              │        │ marker click (popup) │   anchored to marker │
│ N places     │        └──────────────────────┘                      │
│ in this area │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
```

Rules:
- Top bar: `h-14`, logo left (`text-lg font-semibold`, emoji 🗺️ + "nerde"), search center (`max-w-xl flex-1`), right side: Saved (icon+label, hidden below `lg`), "+ Add Place" primary button, avatar/Log in.
- Category rail: `h-11`, horizontally scrollable (`overflow-x-auto`, no visible scrollbar — `scrollbar-none` utility via `[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`), chips with emoji. Clicking a category navigates to `/c/:slug` and applies the map filter; "All" → `/`.
- Sidebar: `w-[360px]`, header row = filter count + "Filters" button (opens dropdown panel with attribute checkboxes for the active category), then place cards sorted by distance from map center, footer = "N places in this area" + loading skeletons while fetching. List is driven by the **current bbox query** (CONTRACTS §6 `GET /api/places?bbox=…`). Clicking a card pans map + selects marker; hovering a card highlights the corresponding marker (and vice versa).
- Map fills all remaining space: this is the "map dominates" requirement made literal — ~75% of viewport width, ~90% of height.

### 6.2 Mobile map home (`<768px`) — full-bleed map + floating controls + bottom sheet

```
┌─────────────────────────────┐
│ ┌─────────────────────────┐ │
│ │🔍 What are you looking… │ │ ← floating search pill, top, mx-3 mt-3, h-12
│ └─────────────────────────┘ │   bg-white rounded-full shadow-md
│ [💪][🦾][🏋️][🚐][🚿] ▸      │ ← category chip rail under search,
│                             │   horizontal scroll, bg-transparent
│         M A P               │   (chips are white pills)
│      full-bleed,            │
│      edge-to-edge           │              ┌────┐
│                             │              │ 🎛 │ ← Filters FAB (only when a
│   📍 markers + clusters     │              └────┘   category is active), right
│                             │              ┌────┐
│                             │              │ 📍│ ← Near me FAB, right side,
│                             │              └────┘   above add button
│                             │              ┌────┐
│                             │              │ + │ ← Add Place FAB, bg-blue-600,
│                             │              └────┘   text-white, 56px, right-bottom
│ ┌─────────────────────────┐ │                         above sheet peek
│ │ ●●●  24 places nearby ▴ │ │ ← bottom sheet PEEK state (h-14):
│ └─────────────────────────┘ │   drag handle + count + nearest place name
│  © OpenStreetMap contrib.   │
└─────────────────────────────┘
```

Bottom sheet (3 snap points — implement with shadcn `Sheet` side="bottom" **only if** snap points aren't needed; recommended: build `BottomSheet` as a small custom component with drag handle + CSS transform, since shadcn Sheet has no snap support. Keep it ≤80 lines, framer-motion is NOT required — pointer events + transform):

1. **Peek** (`h-14`): drag handle (`w-10 h-1 rounded-full bg-neutral-300 mx-auto`), "N places nearby" + first place name. Map fully interactive above it.
2. **Half** (50vh): scrollable place card list. This is the browsing state.
3. **Full** (~90vh): list + sticky header with Filters. Used for deep browsing.

Sheet drag: pointer events on handle + top area; snaps to nearest point with 200ms ease-out. Selecting a marker collapses sheet to peek and shows the preview card above it (see §9.1).

Floating action buttons (FABs): `h-12 w-12 rounded-full bg-white shadow-md border border-neutral-200` with `aria-label`; the **Add** FAB is the exception: `h-14 w-14 bg-blue-600 text-white` (only colored FAB on screen). Order bottom-to-top on right edge: Add → Near me → Filters. Zoom controls: rely on pinch; show `+`/`-` only if trivial (MapLibre `NavigationControl`, bottom-right above FABs is fine).

### 6.3 Place page (`/place/:slug`)

Desktop (≥768px) — two-column over a map header strip:

```
┌──────────────────────────────────────────────────────────────┐
│ top bar (same as home)                                       │
├──────────────────────────────────────────────────────────────┤
│ mini map strip (h-48, non-interactive except click → /?ll=)  │
│ with single marker                                           │
├──────────────────────────────┬───────────────────────────────┤
│ ← Back to map                │                               │
│ 💪 Calisthenics · 🏋️ Outdoor │  SIDEBAR (w-[320px]):         │
│ H1: Maçka Calisthenics Park  │  ┌─────────────────────────┐  │
│ 📍 Beşiktaş, Istanbul, TR    │  │ ♡ Save    ↗ Directions  │  │  ← Directions = external maps link
│ ✓ Verified 12 days ago · 8 ✓ │  ├─────────────────────────┤  │
│                              │  │ ✓ Still there           │  │  ← success outline button
│ [photo][photo][photo]  →     │  │ ⚠ Something's wrong     │  │  ← warning outline button
│ (horizontal scroll, h-40)    │  ├─────────────────────────┤  │
│                              │  │ Added by @ayse · OSM    │  │
│ About                        │  │ 2024-11-02              │  │
│ description text…            │  │ ⚑ Report a problem      │  │
│                              │  └─────────────────────────┘  │
│ Details (attributes)         │                               │
│ 💪 Pull-up bars ✓  Rings ✓   │                               │
│    Lighting ✗  Free ✓ 24/7 ✓ │                               │
│ 🏋️ Free ✓  Lighting ✓        │                               │
│                              │                               │
│ Comments (N)                 │                               │
│ @mehmet: "Great bars…"       │                               │
│ [comment box if logged in]   │                               │
└──────────────────────────────┴───────────────────────────────┘
```

Mobile: single column in the same order: mini-map strip (h-36) → chips → name → address → verification line → Save/Directions row → verify buttons → photos → about → details → comments. Sticky bottom action bar on mobile: `♡ Save | ✓ Still there | ↗ Directions` (h-14, bg-white border-t).

### 6.4 Add Place flow (`/add?lat=&lng=`) — 5 steps

Desktop: centered card (`max-w-lg mx-auto`) over dimmed map (the map stays live underneath and the chosen pin is visible). Mobile: full-screen sheet. Shared stepper header:

```
┌─────────────────────────────────────┐
│ ← Back    Add a place    Step 2 of 5│
│ ●━━━━○────○────○────○  (progress)   │
├─────────────────────────────────────┤
```

**Step 1 — Location (pin):** Map fills the card body (h-[50vh] desktop, full map mobile). Center-fixed pin (📍 32px, category slate color until step 2). Instruction: "Drag the map so the pin sits exactly on the place." Live lat/lng readout (text-xs mono). Button: "Confirm location" (primary, full-width mobile).

**Step 2 — Category:** "What is this place?" Grid of all 18 categories, 2 columns mobile / 3 desktop: each cell = `rounded-lg border p-3` with emoji (`text-2xl`) + name (`text-sm`). Multi-select (a place can have several categories). Selected cells: `border-2` category color + colored dot. Button: "Continue" (disabled until ≥1 selected).

**Step 3 — Info:** Name input (2–80 chars, required), description textarea (optional, 3 rows), then **dynamic attribute fields** per selected category (bool → checkbox chips `Pull-up bars`, `Lighting`…; enum → `Select`; number → `Input type=number`; text → `Input`). Grouped with category emoji headings. Address line auto-filled from reverse geocode, editable. Button: "Continue".

**Step 4 — Photos:** Dashed dropzone (`border-2 border-dashed border-neutral-300 rounded-lg p-6 text-center`) "Tap to add photos" + thumbnails row (80px squares, × remove button). Client resizes to ≤1600px JPEG q0.8 (CONTRACTS §1). Optional step — "Skip" link + "Continue" button.

**Step 5 — Review & submit:** Summary card (mini-map w/ pin, name, category chips, attribute count, photo count) → "Submit place" primary button. Honeypot input `website` hidden here (CONTRACTS §6).

**Duplicate warning (blocking interstitial between step 3→4, or on submit when API returns `409 {duplicates}`):**

```
┌─────────────────────────────────────┐
│ ⚠️ Is this already one of these?     │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 💪 Maçka Calisthenics Park      │ │
│ │ 45 m away · ✓ 8 confirms        │ │
│ │              [View] [This is it]│ │
│ ├─────────────────────────────────┤ │
│ │ 🏋️ Beşiktaş Outdoor Gym         │ │
│ │ 80 m away                       │ │
│ │              [View] [This is it]│ │
│ └─────────────────────────────────┘ │
│ [It's none of these — continue]     │  ← ghost button; re-POSTs with force:true
└─────────────────────────────────────┘
```

"This is it" navigates to the existing place (contribution cancelled, toast: "This place is already on Nerde — you can verify or improve it instead."). Pre-check happens on pin confirm using `GET /api/places/near?radius_km=0.1` so most users see it before typing anything.

### 6.5 Login (`/login`)

Centered card (`max-w-sm`), tabs **Sign in / Sign up** (shadcn `Tabs`):

```
┌───────────────────────────────┐
│ 🗺️ nerde                      │
│ ┌───────────┬───────────────┐ │
│ │ Sign in   │ Sign up       │ │
│ └───────────┴───────────────┘ │
│ Email    [________________]   │
│ Password [________________]   │
│ (+ Username on sign up)       │
│ [Sign in]  (primary, w-full)  │
│ Errors: inline text-red-600   │
│ text-xs under the field       │
└───────────────────────────────┘
```

Copy above the card: "Save places, add new ones, and verify what's still there." Successful auth → redirect back to the page that required it (`?next=` param). Google login: not in MVP (CONTRACTS §1).

### 6.6 Saved places (`/saved`)

```
┌──────────────────────────────────────┐
│ top bar                              │
│ H1: Saved places        [Map view ▾] │ ← toggle: list (default) / map with only saved markers
├──────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐     │
│ │PlaceCard│ │PlaceCard│ │PlaceCard│   │  ← responsive grid:
│ └────────┘ └────────┘ └────────┘     │    1 col mobile, 2 md, 3 xl
└──────────────────────────────────────┘
```

Empty state: "No saved places yet — tap ♡ on any place to keep it here." + "Explore the map" button. Not logged in → prompt card: "Log in to see your saved places." + button to `/login?next=/saved`.

### 6.7 Admin (`/admin`)

Function over beauty (§17). Left nav (`w-48`, links: Dashboard, Reports, Places, Categories), content area with shadcn `Table` components:

- **Dashboard:** 4 stat cards (places, users, open reports, pending places) via `GET /api/admin/stats`.
- **Reports:** table (place, reason, reporter, date, status) + row actions (Resolve / Dismiss / View place). Badge count on nav item.
- **Places:** searchable table (name, categories, source, status, created) + actions (Publish / Remove / Restore, Edit dialog with all fields).
- **Categories:** table + "New category" dialog (name, slug, icon emoji picker = plain text input, color input type="color", group, sort) and per-category attribute editor (rows: key, label, type select, options CSV for enum, filterable checkbox, sort number).

---

## 7. Component Inventory → shadcn/ui Mapping

| UI need | shadcn component | Notes |
|---|---|---|
| Primary/secondary/icon buttons | `Button` | Variants: `default` (blue-600 via theme), `outline` (filters, verify), `ghost` (chip-like nav), `destructive` (remove place). Icon-only: `size="icon"` + `aria-label` |
| Mobile bottom navigation of panels (categories, filters) | `Sheet` (`side="bottom"`) | Used for category picker & filters panels on mobile (NOT the snap-point place-list sheet — that's the custom `BottomSheet`, §6.2) |
| Add Place flow on mobile | `Sheet` full-height or dedicated page | Dedicated route page preferred; simpler |
| Login tabs | `Tabs` | Sign in / Sign up |
| Dialogs: duplicate warning, report, photo lightbox, admin edit, confirm-destructive | `Dialog` / `AlertDialog` | `AlertDialog` for "Remove place?" |
| Search input + results (Nominatim + category matches) | `Command` | `CommandInput` + grouped `CommandGroup`s: "Categories", "Places", rendered in a `Popover` anchored to the search bar (desktop) or full-screen `Dialog` (mobile). Debounce 300ms, 1 req/s to Nominatim (CONTRACTS §1) |
| Category chips, filter chips, place-card category tags | `Badge` + custom chip (button + `rounded-full`) | Chips that toggle are `<button>`s, not Badges (a11y: `aria-pressed`) |
| Place card, preview card, stat cards, login card | `Card` | `p-3` for compact place cards |
| Attribute filters panel | `Checkbox` + `Label` inside `Popover` (desktop) / `Sheet` (mobile) | Bool attrs → checkbox rows; enum/number filters v2 — MVP: bool filter chips only (`filterable` attrs) |
| Toasts | `sonner` | `toast.success("Place saved")` etc. (strings §12). Position `top-center` mobile, `bottom-right` desktop |
| Loading placeholders | `Skeleton` | Sidebar list: 5 skeleton cards; place page: title + photo strip skeletons; map: no skeleton (tiles load), show marker pulse spinner top-center while bbox query runs |
| Dropdowns (user menu, map view toggle) | `DropdownMenu` | User avatar menu: Saved, My places, Admin (if role), Log out |
| Form fields | `Input`, `Textarea`, `Select`, `Label`, `Form` (react-hook-form optional) | Keep it simple: controlled inputs + manual validation messages |
| Attribute display (place page) | `Table`-less: definition rows (`flex justify-between`) | Bool = ✓/✗ icon + label, never bare color |
| Avatar | `Avatar` | Username initials, `bg-neutral-200` |
| Tooltip (desktop icon buttons) | `Tooltip` | "Near me", "Filters" — supplements, never replaces, aria-label |
| Separator lines | `Separator` | Card sections |
| Progress (add flow) | custom dots (§6.4) or `Progress` | Dots communicate "step 2 of 5" better than a bar |
| Scroll areas (sidebar list) | native `overflow-y-auto` | `ScrollArea` optional |
| Comments | `Card` + `Textarea` + `Button` | 500 char cap with counter |
| Empty states | custom (`EmptyState` component) | icon emoji + message + optional CTA (§12 strings) |

Do not add: Carousel, Calendar, DataTable libs, Charts — none needed for MVP.

---

## 8. Interaction Details

### 8.1 Marker click → preview card → place page

1. **Click marker** → map eases to center marker (200ms), marker gets selected style, **preview card** opens anchored to the marker (MapLibre `Popup` with custom HTML, `closeButton: false`, `maxWidth: 280px`; on mobile, card appears as a fixed card above the bottom sheet instead of a popup).
2. **Preview card contents:** thumbnail (if `photo_url`, `h-24 w-full object-cover`), name (`text-sm font-medium`), category chips (max 2 + "+N"), distance if known ("1.2 km away"), verification line (`✓ Verified 12 days ago` in `text-xs text-emerald-600`; if `issue_count > confirm_count` recent → `⚠ Reported issue` in amber), single primary button "View details" (full card is also clickable).
3. **Click card / View details** → navigate `/place/:slug`. Analytics: `place_viewed`.
4. Closing: map click elsewhere, ✕, or Esc removes selection. Mobile: tapping map collapses card.

### 8.2 Filter chips behavior

- Filter rail shows only when a category is active; chips = that category's `filterable` bool attributes (CONTRACTS §4), in `sort` order, horizontal scroll.
- Toggle on → chip selected style (§5.4) + map/sidebar re-query with `&attrs=cat.key,…`. Multiple chips = AND (all must be truthy — matches API contract).
- "Filters" button badge shows active count. "Clear all" appears when ≥1 active. Analytics: `filter_applied` with key.
- Switching category clears attribute filters (they're category-namespaced).

### 8.3 Search (one field — "What are you looking for?")

- Debounced 300ms. Two result sources merged in one `Command` list:
  - **Category/text matches:** `GET /api/search?q=` → "Categories" group (emoji + name, e.g. "💪 Calisthenics Parks") → selecting navigates to `/c/:slug`; "Places" group (name + city) → selecting pans to place + opens preview card.
  - **Geographic:** Nominatim `search?q=&format=json&limit=5` (from browser, attribution, ≤1 req/s) → "Places on the map" group with 📍 results (e.g. "Istanbul, Türkiye") → selecting flies the map to the result bbox. Item shows place type in muted text.
- Enter with no selection → Nominatim top result fly-to. Esc/blur closes. Analytics: `search_performed`.
- Empty query shows "Popular categories" (top 6 by sort) as suggestions.

### 8.4 Near-me button states

| State | Visual | Behavior |
|---|---|---|
| `idle` | 📍 icon, neutral FAB | Click → `navigator.geolocation.getCurrentPosition` |
| `locating` | Spinner (`Loader2` `animate-spin`) in FAB, `aria-busy` | Up to 10s timeout |
| `located` | FAB turns `bg-blue-600 text-white` | Map flies to user (z=14), user dot appears (§5.2), bbox query runs |
| `denied` | Toast: "Location access denied — enable it in your browser to find places near you." | FAB back to idle; no retry loop |
| `unsupported`/error | Toast: "Couldn't get your location." | idle |

Coords are never sent anywhere except the `GET /api/places/near` query params for that search; nothing stored (CONTRACTS §7, MASTER §28). Analytics: `near_me_used`.

### 8.5 Verification (place page + preview)

- Two outline buttons: **"✓ Still there"** (success tint on hover) and **"⚠ Something's wrong"** (warning tint). Require auth — logged-out click → toast "Log in to verify places" + `/login?next=…`.
- Click "✓" → `POST /api/places/:id/verify {type:'confirm'}` → button becomes filled success + "Confirmed by you" state; display line updates to **"Verified just now · N confirmations"** (format: `✓ Verified {N days ago}` via `lib/format.ts`; <24h → "Verified today"; never show if `last_verified_at` null → show "Not verified yet — been there?").
- Click "⚠" → small `Dialog` with optional note textarea + submit → toast "Thanks — we'll take a look." Display: if `issue_count` recent > 0 → amber line "⚠ Issue reported {N days ago}".
- One active vote per user (latest wins, CONTRACTS §6): UI re-fetches place after vote.
- Staleness hint: `last_verified_at` > 180 days → verification line renders in `text-amber-600`: "✓ Verified 214 days ago — confirm it's still there". (Display logic client-side; no schema change.)

### 8.6 Save

♡ outline → filled red heart (`fill-red-500 text-red-500`) on save; `POST/DELETE /api/places/:id/save`; optimistic toggle, rollback + toast on error. Logged out → toast "Log in to save places". Analytics: `place_saved`.

---

## 9. States

### 9.1 Loading

- **Initial app load:** map renders immediately (tiles may still stream); sidebar shows 5 skeleton place cards (`Skeleton` blocks: 64px thumb + 2 text lines); search bar disabled with placeholder "Loading map…".
- **Bbox re-query (pan/zoom):** no skeletons — keep existing markers, show a small top-center pill "Updating…" (`bg-white shadow-md text-xs px-3 py-1`, with spinner) over the map; replace data on arrival.
- **Place page:** title/photo/attribute skeletons in final layout positions.
- **Add flow submit:** primary button `disabled` + spinner + "Submitting…".

### 9.2 Empty

- **Empty map area:** when a bbox query returns 0 places, show a centered floating card over the map (dismissible, auto-hides on next non-empty result):
  "**No places here yet.** Be the first to add one. [+ Add a place]" (button deep-links `/add?lat=<center>&lng=<center>`). Sidebar/mobile sheet shows the same message in-list.
- **Category with zero global results on `/c/:slug`:** same card, plus SEO text block still renders below map on category pages.
- **No search results:** Command list shows "No matches for "{q}" — try a place name or category."
- **Saved empty / not-logged-in:** §6.6 strings.
- **Comments empty:** "No comments yet. Know this place? Say something useful."

### 9.3 Error

- **API failure on bbox query:** toast.error("Couldn't load places — check your connection and retry.") + sidebar inline error card with "Retry" button.
- **Place page 404:** full-page `EmptyState`: "This place doesn't exist (anymore)." + "Back to map".
- **Submit failure:** inline error at top of the add-flow card (`bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm`) with the server's `error` string; preserve all entered data.
- **Photo upload failure:** per-photo error state on thumbnail (red border, retry icon).

### 9.4 Offline

- Detect `navigator.onLine` + `online`/`offline` events → persistent slim banner at very top (`h-8 bg-neutral-900 text-white text-xs text-center`): "You're offline — showing cached map tiles only." Map interactions that need network (search, near, save, add) are disabled with tooltips/toasts explaining why. Loaded markers stay interactive (preview from cached data).

---

## 10. SEO/content notes for layouts (brief — details in SEO_STRATEGY.md)

- `/c/:slug` renders an `h1` ("Calisthenics Parks") + 1–2 sentence description + place count in a collapsible block under the map on mobile, and as sidebar header on desktop.
- `/place/:slug` renders full text content server-side-friendly (SPA limitation documented in SEO_STRATEGY).
- `© OpenStreetMap contributors` attribution visible on every map view (bottom-left, links to osm.org/copyright) + OSM attribution email header for Nominatim (CONTRACTS §7).

---

## 11. Accessibility Basics

- **Focus:** visible focus ring on every interactive element — `focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2` (shadcn default mostly covers this; do not remove outlines).
- **Icon-only buttons** (FABs, zoom, close, heart when icon-only): all get `aria-label` ("Add a place", "Find places near me", "Filters", "Save place", "Close").
- **Map markers:** `role="button"` + `aria-label={place.name}`; keyboard: Tab reaches markers via a "Skip to results list" link on desktop (sidebar list is the keyboard path; each card is a real `<a>`/`<button>`).
- **Touch targets:** minimum 44×44px on mobile (`h-11 w-11` minimum for FAB inner hit area; chips `min-h-[44px]` on mobile even if visual pill is smaller — expand with padding).
- **Color is never the only indicator:** selected chips have border + dot + (on rail) inverted fill; verified state shows ✓ glyph + text; bool attributes show ✓/✗ glyphs, not green/red alone; error fields show message text, not just red border.
- **Contrast:** body text neutral-900/600 on white ≥ 7:1; marker colors chosen ≥3:1 vs light basemap (§5.1); cluster count white on blue-600 ≥ 4.5:1.
- **Motion:** respect `prefers-reduced-motion` — disable sheet transitions and user-dot pulse (`motion-reduce:transition-none`).
- **Forms:** every input has a visible `<Label>` or `aria-label`; errors linked with `aria-describedby`; required marked.
- **Emoji:** decorative emoji get `aria-hidden="true"`; informative emoji (category identity) get adjacent text label always.

---

## 12. Microcopy (exact strings)

All strings live in `src/lib/strings.ts` as a flat typed object (English source; keys = dot paths). Final copy:

```ts
// src/lib/strings.ts
export const strings = {
  search: {
    placeholder: "What are you looking for?",
    loading: "Loading map…",
    noResults: (q: string) => `No matches for "${q}" — try a place name or a category.`,
    groupCategories: "Categories",
    groupPlaces: "Places",
    groupGeo: "Places on the map",
    popular: "Popular categories",
  },
  map: {
    updating: "Updating…",
    placesInArea: (n: number) => `${n} ${n === 1 ? "place" : "places"} in this area`,
    placesNearby: (n: number) => `${n} ${n === 1 ? "place" : "places"} nearby`,
    emptyTitle: "No places here yet.",
    emptyBody: "Be the first to add one.",
    emptyCta: "+ Add a place",
    attribution: "© OpenStreetMap contributors",
  },
  nearMe: {
    button: "Near me",
    locating: "Finding you…",
    denied: "Location access denied — enable it in your browser to find places near you.",
    error: "Couldn't get your location.",
  },
  place: {
    viewDetails: "View details",
    save: "Save",
    saved: "Saved",
    directions: "Directions",
    stillThere: "✓ Still there",
    somethingWrong: "⚠ Something's wrong",
    verifiedDaysAgo: (n: number) => `✓ Verified ${n} ${n === 1 ? "day" : "days"} ago`,
    verifiedToday: "✓ Verified today",
    notVerified: "Not verified yet — been there?",
    issueReported: (n: number) => `⚠ Issue reported ${n} ${n === 1 ? "day" : "days"} ago`,
    stale: (n: number) => `✓ Verified ${n} days ago — confirm it's still there`,
    confirmations: (n: number) => `${n} ${n === 1 ? "confirmation" : "confirmations"}`,
    report: "Report a problem",
    commentsTitle: (n: number) => `Comments (${n})`,
    commentsEmpty: "No comments yet. Know this place? Say something useful.",
    commentPlaceholder: "Share something useful for the next person…",
    addedBy: (u: string) => `Added by @${u}`,
    about: "About",
    details: "Details",
  },
  add: {
    title: "Add a place",
    step: (n: number) => `Step ${n} of 5`,
    step1Title: "Where is it?",
    step1Hint: "Drag the map so the pin sits exactly on the place.",
    confirmLocation: "Confirm location",
    step2Title: "What is this place?",
    step2Hint: "Pick all that apply.",
    step3Title: "Tell us about it",
    nameLabel: "Name",
    namePlaceholder: "e.g. Maçka Calisthenics Park",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "What should people know? Access, best times, condition…",
    addressLabel: "Address",
    step4Title: "Add photos (optional)",
    photosHint: "Tap to add photos",
    skip: "Skip",
    continue: "Continue",
    back: "Back",
    step5Title: "Review and submit",
    submit: "Submit place",
    submitting: "Submitting…",
    duplicateTitle: "Is this already one of these places?",
    duplicateThisIsIt: "This is it",
    duplicateNone: "It's none of these — continue",
    duplicateView: "View",
    duplicateToast: "This place is already on Nerde — you can verify or improve it instead.",
    successToast: "Place added — thanks for contributing! 🎉",
  },
  auth: {
    signIn: "Sign in",
    signUp: "Sign up",
    email: "Email",
    password: "Password",
    username: "Username",
    pitch: "Save places, add new ones, and verify what's still there.",
    loginToSave: "Log in to save places",
    loginToVerify: "Log in to verify places",
    logout: "Log out",
  },
  saved: {
    title: "Saved places",
    empty: "No saved places yet — tap ♡ on any place to keep it here.",
    explore: "Explore the map",
    loggedOut: "Log in to see your saved places.",
  },
  verify: {
    thanks: "Thanks — we'll take a look.",
    confirmed: "Thanks for confirming! ✓",
  },
  errors: {
    loadPlaces: "Couldn't load places — check your connection and retry.",
    retry: "Retry",
    placeNotFound: "This place doesn't exist (anymore).",
    backToMap: "Back to map",
    offline: "You're offline — showing cached map tiles only.",
    generic: "Something went wrong. Try again.",
  },
} as const;
```

Toast patterns: success = `toast.success(...)` (✓ auto), errors = `toast.error(...)`. Keep toasts ≤ 8 words where possible.

---

## 13. Implementation Checklist for Frontend Agent

1. shadcn theme: light only, primary = blue-600, radius 0.5rem.
2. Seed `categories.color` values = §5.1 hex table (coordinate with Backend/Data agents — contract field already exists).
3. Build `MapHomeDesktop` / `MapHomeMobile` as separate shells sharing map state; custom snap-point `BottomSheet` for mobile place list; shadcn `Sheet` for mobile category/filter panels.
4. HTML markers per §5.2 with `.marker-selected` as the only custom CSS class; cluster layer per §5.3.
5. Preview card = MapLibre Popup (desktop) / fixed card above sheet (mobile).
6. Strings: copy §12 into `src/lib/strings.ts` verbatim; no hard-coded UI text elsewhere.
7. Every icon-only button: `aria-label`; every interactive chip: `<button aria-pressed>`; touch targets ≥44px.
8. No gradients, no glassmorphism, no decorative animation — QA will check (see TEST_PLAN.md).

*End of DESIGN_SYSTEM.md — open questions for Product Lead: (a) whether enum attribute filters (water_type, best_time) become Select-based filters post-MVP; (b) "Map view" toggle on /saved is flagged optional-cheap.*
