# Nerde.com — DATA_SOURCES.md

**Owner:** Agent 7 — Geographic Data Engineer
**Purpose:** Source research + licensing + seed-import design for `app/scripts/import-osm.ts` (implemented by the Backend agent — this document is the spec, no code here).
**Companion contracts:** `CONTRACTS.md` §2 (repo layout), §4 (18 categories + attribute keys), §5 (`places.source` / `places.source_ref`, unique partial index `places_source_ref`).

## 0. Method & verification status

Every OSM tag claim below was verified **this turn** against the live OSM Wiki and the taginfo API. Global object counts are taginfo `/api/4/tag/stats` snapshots dated **2026-09-18** (`data_until` returned by the API). Anything that could not be verified this turn is explicitly marked **(unverified)**.

Verification log (all fetched this turn):

- Tag/key pages: `leisure=fitness_station`, `sport=calisthenics`, `sport=powerlifting`, `sport=climbing`, `Climbing` (Key:climbing), `sport=skateboard` (via search extract), `Proposal:Skatepark`, `sport=parkour`, `sport=basketball`, `sport=table_tennis`, `tourism=caravan_site`, `amenity=shower`, `amenity=drinking_water`, `amenity=bbq`, `leisure=picnic_table`, `tourism=picnic_site`, `leisure=swimming_area`, `leisure=bathing_place`, `tourism=viewpoint`, `tourism=photopoint`, `amenity=sanitary_dump_station`, `Key:maxstay`, `Key:lit`, `Key:fee`, `Key:opening_hours`, `Key:fitness_station`
- Reference pages: `Overpass_API`, `Overpass_API/Overpass_QL`, `https://www.openstreetmap.org/copyright`
- Counts: taginfo API for 25 tags (see §1 tables)
- Note: `Tag:leisure=skatepark` returns **404** — the wiki page does not exist; skateparks are covered by `sport=skateboard` + a rejected-or-stalled `leisure=skatepark` proposal (details in §1.6).

---

## 1. OSM tag research — per category

Reading guide for the query snippets:

- `{{bbox}}` = `south,west,north,east` (this order is verified in the Overpass QL reference).
- All queries end `out center;` → nodes carry `lat/lon`; ways/relations carry `center.lat/center.lon` (verified: `center` "adds only the centre of the bounding box to ways and relations… not guaranteed to lie inside the polygon" — acceptable for POI pins).
- Because OSM allows multi-sport values like `sport=basketball;volleyball`, every `sport` filter uses a semicolon-aware regex: `["sport"~"(^|;) *<value> *(;|$)"]`.
- Suggested coverage ratings: **good** (>25k global objects, reliable in big cities), **sparse** (hundreds–few thousand, patchy), **rare** (<100, effectively unusable for seeding).

### Shared OSM key → Nerde attribute rules (used in every table below)

| OSM tag (verified) | Nerde attr key(s) | Rule |
|---|---|---|
| `fee=no` | `free` → `true` | `fee=yes` → `free:false`; `fee=donation` → treat as `true`; **tag absent → leave unset** (absence ≠ free) ([Key:fee](https://wiki.openstreetmap.org/wiki/Key:fee)) |
| `opening_hours=24/7` | `access_24_7` → `true` | Any other value → leave unset (parsing full OH syntax is out of scope; value `24/7` verified on [Key:opening_hours](https://wiki.openstreetmap.org/wiki/Key:opening_hours)) |
| `lit=yes` / `lit=24/7` | `lighting` → `true` | `lit=no`/`disused` → `false`; absent → unset ([Key:lit](https://wiki.openstreetmap.org/wiki/Key:lit)) |
| `indoor=yes` | `indoor_outdoor` → `indoor` | `indoor=no` or indoor-irrelevant outdoor features → `outdoor`; absent → category default below |
| `drinking_water=yes` (secondary tag) | `drinking_water` → `true` | Verified as secondary-feature pattern on [amenity=drinking_water](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Ddrinking_water) and `tourism=picnic_site` pages |
| `charge=*` | `price` (number) | Parse leading float only; currency not normalized in v1 |

### 1.1 `calisthenics` 💪 Calisthenics Parks — coverage: **good** (via fitness stations)

**Verified tags:** `leisure=fitness_station` (de facto; 102,309 objects; "a fitness station (outdoor gym), calisthenics park or trim trail… typically operated by a local government and free to use (usually 24/7)" — [wiki](https://wiki.openstreetmap.org/wiki/Tag:leisure%3Dfitness_station)). `sport=calisthenics` (in use; 754 objects — sparse; combined with `leisure=fitness_station|fitness_centre|pitch|sports_hall|sports_centre` — [wiki](https://wiki.openstreetmap.org/wiki/Tag:sport%3Dcalisthenics)).

**Overpass QL** (shared with `outdoor-gyms` — run once, classify twice):

```
[out:json][timeout:60];
(
  nwr["leisure"="fitness_station"]({{bbox}});
  nwr["sport"~"(^|;) *calisthenics *(;|$)"]({{bbox}});
);
out center;
```

Optional phase-2 equipment enrichment (individual devices are mapped as separate nodes per [Key:fitness_station](https://wiki.openstreetmap.org/wiki/Key:fitness_station)):

```
node["fitness_station"]({{bbox}}); out center;
```

**Attribute mapping** (equipment values from Key:fitness_station, verified):

| OSM | Nerde key | Rule |
|---|---|---|
| `fitness_station=horizontal_bar` or `fitness_station:horizontal_bar=yes` (also in `;`-lists) | `pull_up_bars` | → `true` |
| `fitness_station=parallel_bars` / `dip_bench` / `captains_chair` | `parallel_bars` | → `true` (parallel_bars); `dip_bars` → `true` for dip_bench/captains_chair |
| `fitness_station=horizontal_ladder` ("monkey bars" per wiki) | `monkey_bars` | → `true` |
| `fitness_station=rings` | `rings` | → `true` |
| shared rules | `lighting`, `free`, `access_24_7` | see shared table |
| `indoor=*` | `indoor_outdoor` | default `outdoor` (fitness stations are outdoor by definition) |
| `surface=rubber/concrete/grass/sand` | `ground_surface` | exact match; `tartan/asphalt/woodchips/…` → `mixed`; absent → unset |

**Classification rule (calisthenics vs outdoor-gyms):** an element is tagged `calisthenics` **in addition to** `outdoor-gyms` when `sport=calisthenics` is present **or** bar-type equipment (`horizontal_bar|parallel_bars|rings|horizontal_ladder|wall_bars`) is detected; otherwise it lands in `outdoor-gyms` only.

### 1.2 `arm-wrestling` 🦾 — coverage: **none in OSM** (rare to the point of zero)

Verified via taginfo: `sport=arm_wrestling` → **0 objects**; `sport=armwrestling` → **1 object**; the [Key:sport](https://wiki.openstreetmap.org/wiki/Key:sport) value list contains no arm-wrestling value. **No Overpass query is defined.** Strategy: curated seed (§5) + community. No attribute mapping possible.

### 1.3 `outdoor-gyms` 🏋️ Outdoor Gyms — coverage: **good**

Same verified source as §1.1 (`leisure=fitness_station`, 102,309). The wiki explicitly equates the tag with "outdoor gym". Shares the §1.1 query.

| OSM | Nerde key | Rule |
|---|---|---|
| shared rules | `free`, `lighting`, `access_24_7` | see shared table |
| `fitness_station=*` values (joined with `;`) or `fitness_station:<type>=yes` prefix list | `equipment` (text) | comma-joined humanized list, e.g. `horizontal bar, parallel bars` |
| — | `shaded` | **no OSM tag** → leave unset (unmapped) |

### 1.4 `powerlifting` 🏋️‍♂️ Powerlifting Gyms — coverage: **rare in OSM**

Verified: `sport=powerlifting` (status "in use", **9 objects**; combined with `leisure=fitness_centre|pitch|sports_hall|sports_centre|club=sport` — [wiki](https://wiki.openstreetmap.org/wiki/Tag:sport%3Dpowerlifting)); `sport=weightlifting` → 297 objects (weak proxy — includes recreational weight rooms, **not** powerlifting-specific); `leisure=fitness_centre` itself is abundant (107,865) but carries no powerlifting signal.

**Overpass QL** (cheap, keep for completeness):

```
[out:json][timeout:60];
(
  nwr["sport"~"(^|;) *powerlifting *(;|$)"]({{bbox}});
  nwr["sport"~"(^|;) *weightlifting *(;|$)"]({{bbox}});
);
out center;
```

| OSM | Nerde key | Rule |
|---|---|---|
| `membership=required` | `membership_required` → `true` | pattern verified on [Key:fee](https://wiki.openstreetmap.org/wiki/Key:fee) |
| `charge=*` | `day_pass_price` | leading float |
| — | `competition_plates`, `deadlift_platform`, `squat_racks`, `drop_ins` | **unmapped** — no OSM tags |

**Honest assessment:** OSM cannot seed this category meaningfully (~9 real powerlifting objects worldwide). Import what exists; expect the bulk from curated/community (§5).

### 1.5 `climbing` 🧗 Climbing / Bouldering — coverage: **good**

Verified: `sport=climbing` (de facto; 73,680 objects — [wiki](https://wiki.openstreetmap.org/wiki/Tag:sport%3Dclimbing)). The [Climbing feature page](https://wiki.openstreetmap.org/wiki/Climbing) carries an explicit **"Note for data consumers"**: query **both** `sport=climbing` **and** `climbing=*` roots, because either may be missing. Relevant `climbing=*` values for places: `boulder`, `crag`, `area` (skip `route`, `route_bottom`, `route_top`, `bolt`, `abseil_route` — individual routes, not places).

**Overpass QL:**

```
[out:json][timeout:60];
(
  nwr["sport"="climbing"]({{bbox}});
  nwr["climbing"~"^(boulder|crag|area)$"]({{bbox}});
);
out center;
```

| OSM | Nerde key | Rule |
|---|---|---|
| `climbing=boulder` or `climbing:boulder=yes` (also `limited`, or a route count) | `bouldering` → `true` | `climbing:boulder=no` → `false` |
| `climbing:sport=yes|limited|<n>` / `climbing:toprope=yes` / `climbing:trad=yes` | `rope_climbing` → `true` | all three `no`/absent → unset |
| `climbing:rock=granite|limestone|sandstone` | `rock_type` | exact; `basalt` etc. → `other`; absent → unset |
| `indoor=yes`, or `leisure=sports_hall`/`sports_centre` with `building=*` | `indoor_outdoor` → `indoor` | `natural=rock|stone|cliff`, or `indoor=no`, or none of the above → `outdoor` |
| shared rules | `free` | `fee=*` on gyms |
| — | `crash_pads_needed` | **unmapped** (optional heuristic: outdoor boulder → `true`, marked as guess; recommend leaving unset) |

### 1.6 `skateparks` 🛹 Skateparks — coverage: **good** (via pitch+sport)

Verified: the de-facto tagging is `leisure=pitch` + `sport=skateboard` (`sport=skateboard` de facto, 29,880 objects — [wiki](https://wiki.openstreetmap.org/wiki/Tag:sport%3Dskateboard)). `Tag:leisure=skatepark` is a **404** on the wiki; `leisure=skatepark` exists only as a [proposal](https://wiki.openstreetmap.org/wiki/Proposal:Skatepark) and has **1 object** in taginfo. Query the proposal tag anyway (costs one extra line, future-proof).

**Overpass QL:**

```
[out:json][timeout:60];
(
  nwr["leisure"="pitch"]["sport"~"(^|;) *skateboard *(;|$)"]({{bbox}});
  nwr["leisure"="skatepark"]({{bbox}});
);
out center;
```

| OSM | Nerde key | Rule |
|---|---|---|
| `indoor=yes` / `building=*` enclosing | `indoor_outdoor` → `indoor` | else `outdoor` |
| shared rules | `free`, `lighting` | `fee=*`, `lit=*` |
| `surface=concrete|wood|metal` | `surface` | exact; else unset |
| `skatepark:bowl=yes`, `skatepark:street=yes` | `bowl`, `street_section` | **(unverified)** — equipment prefix comes from the unratified proposal; map if present, expect ~0 hits |

### 1.7 `parkour` 🤸 Parkour Spots — coverage: **sparse**

Verified: `sport=parkour` (in use; 370 objects — [wiki](https://wiki.openstreetmap.org/wiki/Tag:sport%3Dparkour)); combined with `leisure=pitch|sports_centre`; combos documented: `lit=*`, `surface=*`, `barrier=wall`.

**Overpass QL:** `nwr["sport"~"(^|;) *parkour *(;|$)"]({{bbox}}); out center;`

| OSM | Nerde key | Rule |
|---|---|---|
| shared rules | `free`, `lighting`, `access_24_7` | `fee`, `lit`, `opening_hours` |
| `indoor=*` | `indoor_outdoor` | default `outdoor` |

### 1.8 `basketball` 🏀 Basketball Courts — coverage: **good (excellent)**

Verified: `leisure=pitch` + `sport=basketball` (de facto; 345,141 objects — [wiki](https://wiki.openstreetmap.org/wiki/Tag:sport%3Dbasketball)); documented combos include `hoops=*`, `surface=*`, `lit=*`, `indoor=*`, `fee=*`, `access=*`.

**Overpass QL:** `nwr["leisure"="pitch"]["sport"~"(^|;) *basketball *(;|$)"]({{bbox}}); out center;`

| OSM | Nerde key | Rule |
|---|---|---|
| `hoops=<n>` (digits; `0-2` ranges → take max) | `hoops` | number; absent → unset |
| `hoops:nets=none` | `nets` → `false` | `chord|chain` → `true`; **(proposed tag)** per wiki, use opportunistically |
| `surface=asphalt|concrete|wood|parquet` | `surface` | `parquet→wood`; `tartan|acrylic|synthetic→synthetic`; else unset |
| shared rules | `free`, `lighting` | |
| `indoor=yes` | `indoor_outdoor` → `indoor` | else `outdoor` |

### 1.9 `table-tennis` 🏓 Public Table Tennis — coverage: **good**

Verified: `leisure=pitch` + `sport=table_tennis` (de facto; 54,189 objects — [wiki](https://wiki.openstreetmap.org/wiki/Tag:sport%3Dtable_tennis)); documented: `capacity=*` = **number of tables** (default 1), `material`, `pitch:net`, `playability`.

**Overpass QL:** `nwr["leisure"="pitch"]["sport"~"(^|;) *table_tennis *(;|$)"]({{bbox}}); out center;`

| OSM | Nerde key | Rule |
|---|---|---|
| `capacity=<n>` | `tables` | number; absent → unset (do not assume 1 — keep unknown unknown) |
| shared rules | `free`, `lighting` | |
| `indoor=yes` | `indoor_outdoor` → `indoor` | else `outdoor` |
| — | `bring_own_paddles` | **unmapped** — no OSM tag |

### 1.10 `vanlife` 🚐 Vanlife Spots — coverage: **good**

Verified: `tourism=caravan_site` (de facto; 36,583 objects; definition: "a place where you can stay in a caravan overnight or for longer periods" — [wiki](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dcaravan_site)); documented attributes: `fee`, `power_supply`, `sanitary_dump_station=yes/no`, `toilets=yes/no`, `water_point=yes/no`, `drinking_water`, `maxlength`, `maxstay`, `maxweight`, `tents`, `caravans`, `opening_hours`, `caravan_site=motorhome_stopover`. Also relevant as standalone service points: `amenity=sanitary_dump_station` (approved; 11,449 — [wiki](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dsanitary_dump_station)) and `amenity=water_point` (tank refills, referenced from the drinking-water page). `shower=yes` as a property tag on accommodations is documented on the [amenity=shower](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dshower) page.

**Overpass QL:**

```
[out:json][timeout:60];
(
  nwr["tourism"="caravan_site"]({{bbox}});
  nwr["amenity"="sanitary_dump_station"]({{bbox}});
  nwr["amenity"="water_point"]({{bbox}});
);
out center;
```

| OSM | Nerde key | Rule |
|---|---|---|
| (tag definition) | `overnight_allowed` → `true` | caravan_site is overnight-by-definition; dump stations/water points → **do not set** (they are service points, not sleeping spots — consider importing them as `vanlife` with `overnight_allowed` unset, or skip; recommend: import, flag `service_point` in `description`) |
| `fee=no/yes` | `free` | shared rule |
| `toilets=yes` | `toilet` → `true` | `no` → `false` |
| `shower=yes` | `shower` → `true` | |
| `drinking_water=yes` / `water_point=yes` | `drinking_water` → `true` | |
| `power_supply=yes` | `electricity` → `true` | |
| `sanitary_dump_station=yes` | `waste_disposal` → `true` | |
| `maxlength=<m>` | `max_vehicle_length` | number |
| `maxstay=*` | → append to `description` ("Max stay: 2 days") | no matching attr key |
| — | `quiet`, `mobile_signal`, `height_restriction` | **unmapped** — no verified OSM tag (`maxheight=*` exists for vehicle clearance but was **(unverified)** this turn) |

### 1.11 `overnight-parking` 🅿️ Overnight Parking — coverage: **sparse (honest)**

Verified: `maxstay=*` (approved key; used with `amenity=parking` — [Key:maxstay](https://wiki.openstreetmap.org/wiki/Key:maxstay)). **But** `maxstay` encodes *parking duration*, not *sleeping-in-vehicle legality* — OSM has no established "overnight sleeping allowed" tag. The closest explicit, verifiable source is `tourism=caravan_site` with `caravan_site=motorhome_stopover` (subtype documented on the caravan_site page).

**Overpass QL** (deliberately narrow — plain `amenity=parking` is too noisy and legally ambiguous):

```
[out:json][timeout:60];
nwr["tourism"="caravan_site"]["caravan_site"="motorhome_stopover"]({{bbox}});
out center;
```

Elements matched here also belong to `vanlife` → assign **both** categories. Attr mapping: `overnight_allowed→true`, `fee→free`, `maxstay→description`; `toilet`, `quiet`, `security`, `height_restriction` → **unmapped**. Do **not** bulk-import `amenity=parking` in v1.

### 1.12 `public-showers` 🚿 Public Showers — coverage: **good**

Verified: `amenity=shower` (de facto; 37,422 objects — [wiki](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dshower)); documented: `fee`, `hot_water=yes/fee/no`, `indoor=yes`, `outdoor=yes`, `opening_hours`, `access=customers`.

**Overpass QL:** `nwr["amenity"="shower"]({{bbox}}); out center;`

| OSM | Nerde key | Rule |
|---|---|---|
| shared rules | `free`, `access_24_7` | `fee`, `opening_hours=24/7` |
| `hot_water=yes` → `hot_water:true`; `hot_water=no` → `false`; `hot_water=fee` → `true` + note in description | `hot_water` | |
| `indoor=yes` → `indoor`; `outdoor=yes` → `outdoor` | `indoor_outdoor` | both absent → unset |
| `charge=*` | `price` | leading float |
| `access=customers` / `access=private` | — | **skip element** (not a public shower) |

### 1.13 `drinking-water` ⛲ Drinking Water — coverage: **good (excellent)**

Verified: `amenity=drinking_water` (**approved**; 367,711 objects; implies `drinking_water=yes` — [wiki](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Ddrinking_water)); documented: `seasonal=yes`, `bottle`, `indoor`, `fee` (rare). Lifecycle: `disused:amenity=drinking_water` for non-working features — the importer must skip `disused:*`-prefixed elements.

**Overpass QL:** `nwr["amenity"="drinking_water"]({{bbox}}); out center;`

| OSM | Nerde key | Rule |
|---|---|---|
| (tag definition) | `potable_confirmed` → `true` | tag is potable-by-definition |
| `seasonal=yes` | `seasonal` → `true` | `seasonal=no` → `false` |
| `fee=no` (typical) | `free` → `true` | shared rule |
| `opening_hours=24/7` | `access_24_7` → `true` | rarely tagged |

### 1.14 `bbq-picnic` 🍖 BBQ & Picnic Areas — coverage: **good**

Verified: `amenity=bbq` (de facto; 47,093 — [wiki](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dbbq); documented: `covered`, `fuel=wood/charcoal/gas/electric`, `wood_provided`); `leisure=picnic_table` (de facto; 498,189 — [wiki](https://wiki.openstreetmap.org/wiki/Tag:leisure%3Dpicnic_table); documented: `covered`, `lit`); `tourism=picnic_site` (de facto; 168,578 — [wiki](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dpicnic_site); documented property tags: `bbq=*`, `firepit=*`, `fireplace=*`, `openfire=*`, `drinking_water=*`). Note the wiki's own guidance: `leisure=picnic_table` = single table; `tourism=picnic_site` = area with several elements. **There is no `amenity=picnic_table`** — correct tag is `leisure=picnic_table` (an `amenity=picnic_table` mention appears only as a legacy "see also" on the picnic_site page).

**Overpass QL:**

```
[out:json][timeout:60];
(
  nwr["amenity"="bbq"]({{bbox}});
  nwr["tourism"="picnic_site"]({{bbox}});
  nwr["leisure"="picnic_table"]({{bbox}});
);
out center;
```

| OSM | Nerde key | Rule |
|---|---|---|
| `amenity=bbq` (definition: grill surface present) | `bbq_grill` → `true` | |
| `bbq=yes` on picnic_site | `bbq_grill` → `true` | `bbq=bring_your_own` → `false` + note |
| `firepit=yes` / `openfire=yes` / `leisure=firepit` | `fire_allowed` → `true` | |
| `leisure=picnic_table` or `picnic_table=yes` | `tables` → `true` | |
| `drinking_water=yes` | `drinking_water` → `true` | |
| shared rules | `free` | |
| — | `toilets_nearby` | **unmapped** (proximity computation possible later via PostGIS; not in v1) |

### 1.15 `swimming-spots` 🏊 Swimming Spots — coverage: **moderate/sparse**

Verified: `leisure=swimming_area` (de facto; 6,861; officially designated water area; combos `lifeguard=*`, `supervised`, `sport=swimming` — [wiki](https://wiki.openstreetmap.org/wiki/Tag:leisure%3Dswimming_area)); `leisure=bathing_place` (in use; 5,849; "wild swimming spot… limited facilities"; combos `shower/toilets/bbq/drinking_water/picnic_table=yes/no`, `informal=yes` — [wiki](https://wiki.openstreetmap.org/wiki/Tag:leisure%3Dbathing_place)); `natural=beach` (249,556) only as an **opt-in** supplement when combined with `sport=swimming` (110,054 objects) to avoid importing every strip of sand.

**Overpass QL:**

```
[out:json][timeout:60];
(
  nwr["leisure"="swimming_area"]({{bbox}});
  nwr["leisure"="bathing_place"]({{bbox}});
  nwr["natural"="beach"]["sport"~"(^|;) *swimming *(;|$)"]({{bbox}});
);
out center;
```

| OSM | Nerde key | Rule |
|---|---|---|
| `leisure=swimming_pool` (if later included) | `water_type=pool` | v1 query only covers natural water → `water_type` **unset unless** heuristic below fires |
| `natural=beach` elements | `water_type=sea` + `entry_type=beach` | heuristic for coastal beaches only (**heuristic, mark derived**); lake/river vs sea cannot be decided from the element alone in v1 → leave `water_type` unset for swimming_area/bathing_place |
| `lifeguard=yes` | `lifeguard` → `true` | `lifeguard=no` → `false` |
| shared rules | `free` | |
| — | `cold_water` | **unmapped** (OSM `cold_water=*` exists on drinking-water features, not bathing) |

### 1.16 `viewpoints` 🌄 Viewpoints — coverage: **good (excellent)**

Verified: `tourism=viewpoint` (de facto; 263,399 — [wiki](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dviewpoint)); documented: `direction=*` (`W`, `S-W`, `330-30`, `0-360`), `viewpoint=platform|natural`.

**Overpass QL:** `nwr["tourism"="viewpoint"]({{bbox}}); out center;`

| OSM | Nerde key | Rule |
|---|---|---|
| `direction=*` | `sunset_facing` / `sunrise_facing` | parse compass ranges to degrees; viewing arc intersects **240°–300° (WSW–WNW)** → `sunset_facing:true`; intersects **60°–120°** → `sunrise_facing:true`; `0-360` → both; heuristic — document as derived |
| shared rules | `free`, `access_24_7` | rarely tagged |
| — | `seating`, `hike_required` | **unmapped** (no verified tag on the viewpoint object itself) |

### 1.17 `sunset-spots` 🌇 Sunset Spots — coverage: **none in OSM**

No sunset tag exists on the OSM wiki (searched this turn; nothing found). Only weak proxy: `tourism=viewpoint` with west-facing `direction=*` (§1.16) — the importer may **optionally** also tag such viewpoints as `sunset-spots` behind a flag `--sunset-from-viewpoints`, clearly marked as a derived heuristic. Otherwise: curated + community (§5). Attrs `west_facing`, `seating`, `crowded`: unmapped.

### 1.18 `photo-spots` 📷 Photography Spots — coverage: **rare in OSM**

Verified: `tourism=photopoint` (status **proposed**; 83 objects — [wiki](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dphotopoint)) — "a place specifically located or designed for tourists to take photos". Many competing one-off variants exist (`tourism=photo_spot`, `amenity=photo_spot`…), all negligible.

**Overpass QL** (cheap, keep): `nwr["tourism"="photopoint"]({{bbox}}); out center;`

Attrs (`best_time`, `subject`, `drone_friendly`): **unmapped**. Honest assessment: OSM cannot seed this category; curated + community (§5). `viewpoints` can act as a UX fallback layer ("nearby viewpoints") but should **not** be mass-tagged as photo-spots.

### 1.19 Coverage summary (taginfo, 2026-09-18)

| Category | Source tag(s) | Global objects | Coverage |
|---|---|---|---|
| calisthenics | `sport=calisthenics` + `leisure=fitness_station` | 754 + 102,309 | good (via fitness_station) |
| arm-wrestling | — | 0–1 | **none** |
| outdoor-gyms | `leisure=fitness_station` | 102,309 | good |
| powerlifting | `sport=powerlifting` | 9 | **rare** |
| climbing | `sport=climbing` (+`climbing=*`) | 73,680 | good |
| skateparks | `leisure=pitch`+`sport=skateboard` | 29,880 | good |
| parkour | `sport=parkour` | 370 | sparse |
| basketball | `leisure=pitch`+`sport=basketball` | 345,141 | good (excellent) |
| table-tennis | `leisure=pitch`+`sport=table_tennis` | 54,189 | good |
| vanlife | `tourism=caravan_site` (+dump/water points) | 36,583 (+11,449) | good |
| overnight-parking | `caravan_site=motorhome_stopover` subset | (subset) | sparse |
| public-showers | `amenity=shower` | 37,422 | good |
| drinking-water | `amenity=drinking_water` | 367,711 | good (excellent) |
| bbq-picnic | `amenity=bbq` / `leisure=picnic_table` / `tourism=picnic_site` | 47k / 498k / 169k | good |
| swimming-spots | `leisure=swimming_area` + `leisure=bathing_place` | 12,710 | moderate/sparse |
| viewpoints | `tourism=viewpoint` | 263,399 | good (excellent) |
| sunset-spots | — (direction heuristic only) | — | **none** |
| photo-spots | `tourism=photopoint` | 83 | **rare** |

---

## 2. Licensing — ODbL & Overpass usage policy

### 2.1 OpenStreetMap license (verified at [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright))

OSM data is licensed under the **Open Data Commons Open Database License (ODbL)** by the OSM Foundation. Per the copyright page summary (fetched this turn):

- You may **copy, distribute, transmit and adapt** the data, as long as you **credit OpenStreetMap and its contributors**.
- If you **alter or build upon** the data, you may distribute the result **only under the same license** (share-alike).
- Required attribution actions: (1) display the attribution notice — **"© OpenStreetMap contributors"**; (2) make clear the data is available under the ODbL, e.g. by linking to `https://www.openstreetmap.org/copyright` (in data-form redistribution, name and link the license directly).

**What this means for Nerde.com:**

- **Map UI (produced work):** the interactive map (OSM raster tiles) and every place page showing OSM-derived data must show "© OpenStreetMap contributors" with a link to osm.org/copyright — standard map-corner attribution, plus a line on place pages sourced from OSM (CONTRACTS §7 already plans attribution in UI + this file).
- **Derived database (our `places` table):** rows imported from OSM are an *adapted database*. ODbL share-alike means that if we publicly use a database built on OSM data, the adapted database (the OSM-derived portion) must be offered under ODbL on request. Practical compliance: (a) keep `source='osm'` + `source_ref='osm:<type>/<id>'` on every imported row — this is our extraction mechanism for the OSM-derived subset; (b) community-contributed rows (`source='community'`) are our own and not share-alike-encumbered; (c) community **edits** to OSM-sourced rows should be treated as part of the derived subset. This summary is engineering guidance, **not legal advice**; read the full legal code at opendatacommons.org before launch if the data model grows more complex.
- **Do not copy from Google Maps etc.** — and equally: Nerde must not let imports mix in non-compatible sources (see §6 caveats).
- Map tiles: OSM's own tile/API services have separate usage policies (Tile Usage Policy, Nominatim Usage Policy) — noted on the copyright page; tiles at MVP scale are fine with attribution (see CONTRACTS §1).

### 2.2 Overpass API usage policy (verified on the [Overpass_API wiki page](https://wiki.openstreetmap.org/wiki/Overpass_API))

Primary endpoint: `https://overpass-api.de/api/interpreter` (FOSSGIS-operated). Policy quoted from the wiki's instance table:

- One-off use is fine under **< 10,000 queries/day and < 1 GB data/day**.
- For **regular/automated** use: divide by 100 → stay under **~100 queries / ~10 MB per day**.
- Send a **`User-Agent` (or `Referer`) header that uniquely identifies the app** — for us: `NerdeOSMImport/0.1 (contact: $NERDE_OSM_ATTRIBUTION_EMAIL)` (env var already in CONTRACTS §7).
- **No parallel scripts** — run queries strictly sequentially.
- On HTTP **429 or 406** (and other errors): **pause ≥ 30 s** before the next request; use exponential backoff (30 s → 60 s → 120 s …, max ~5 retries), then skip the query and log it.
- Commercial/heavy use should self-host or use a paid instance; alternative public instances listed on the wiki (e.g. `https://overpass.private.coffee/api/interpreter` — no rate limit, but notify them for large-scale use; VK Maps instance). Make the endpoint configurable (`--endpoint`).
- Query hygiene: `[timeout:60]` server-side per query, client timeout 120–180 s; add `[maxsize:…]` only if needed.
- **Cache raw Overpass JSON responses** to disk (e.g. `app/db/overpass-cache/<hash>.json`) so dev re-runs don't re-hit the API — this keeps us far under the limits.

A full MVP seed run (12 cities × ~14 category queries ≈ **170 sequential queries**, most returning KB–low-MB) fits comfortably inside the one-off budget, and with caching stays trivially inside the regular-use budget for re-runs.

---

## 3. Import pipeline design — `app/scripts/import-osm.ts`

(Erasable-TypeScript Node script per CONTRACTS §1/§2; run via `npm run import:osm`. This section is the implementation spec for the Backend agent.)

### 3.1 Configuration

**CITIES** — each `{ slug, city, country, country_code, bbox:[S,W,N,E] }`. Approximate starter bboxes (tune freely; none cross the antimeridian):

| slug | S | W | N | E |
|---|---|---|---|---|
| istanbul | 40.82 | 28.55 | 41.30 | 29.45 |
| berlin | 52.34 | 13.10 | 52.67 | 13.76 |
| barcelona | 41.32 | 2.06 | 41.47 | 2.23 |
| munich | 48.06 | 11.36 | 48.25 | 11.72 |
| london | 51.29 | -0.51 | 51.69 | 0.33 |
| amsterdam | 52.29 | 4.74 | 52.43 | 5.07 |
| new-york | 40.50 | -74.26 | 40.92 | -73.69 |
| san-francisco | 37.71 | -122.51 | 37.83 | -122.36 |
| los-angeles | 33.70 | -118.67 | 34.34 | -118.16 |
| sydney | -34.12 | 151.00 | -33.70 | 151.34 |
| tokyo | 35.53 | 139.56 | 35.82 | 139.92 |
| sao-paulo | -23.88 | -46.82 | -23.36 | -46.37 |

**CATEGORY_QUERIES** — per category slug, one Overpass QL template from §1 (with `{{bbox}}` substitution), plus a `map(element) → {categories[], attrs}` function implementing that category's mapping table and the shared key rules.

### 3.2 Query execution

1. For each selected city × category: render QL, POST `data=<urlencoded query>` to the endpoint with the identifying `User-Agent`.
2. **Sequential only**; sleep 3–5 s between requests; backoff on 429/406/5xx per §2.2.
3. Cache each raw response (key = hash of query+endpoint); `--no-cache` to bypass.
4. Parse `elements[]`: `type ∈ node|way|relation`, `id`, `tags`. Coordinates: nodes → `lat/lon`; ways/relations → `center.lat/center.lon`. Skip elements with no coordinates or no tags.
5. Skip lifecycle-prefixed features: any element whose relevant key appears only as `disused:*`/`abandoned:*`.
6. Skip `access=private|customers` for public-amenity categories (showers, drinking water, bbq).

### 3.3 Mapping to DB rows

Per element → one place row:

- `source='osm'`, `source_ref='osm:'+type+'/'+id` (e.g. `osm:node/123`, `osm:way/456`, `osm:relation/789`) — matches CONTRACTS §5 example.
- `name`: `tags.name` → `tags['name:en']` → generic fallback per category ("Fitness station", "Drinking water", "Viewpoint", …). Slug: slugified name + short id suffix (CONTRACTS §3); derive the suffix deterministically from `source_ref` (e.g. first 4 chars of a hash) so re-imports regenerate the **same** slug.
- `lat/lng` from §3.2 step 4. `city/region/country/country_code` from the CITIES config (no reverse geocoding — respects Nominatim policy).
- `description`: `tags.description` if present; otherwise empty. Append provenance note + `maxstay`/other unmapped extras where defined in §1.
- `attrs`: namespaced keys `"<category_slug>.<key>"` per CONTRACTS §5, **only set when an OSM source tag exists** — never invent `false` (quality rule; see §1 shared table). On re-import, only replace keys belonging to OSM-managed categories.
- `place_categories`: resolve slug → `categories.id`; `INSERT OR IGNORE`.

### 3.4 Idempotency & upserts

- Guaranteed by the existing schema: `CREATE UNIQUE INDEX places_source_ref ON places(source_ref) WHERE source_ref IS NOT NULL` (CONTRACTS §5).
- Upsert: `INSERT … ON CONFLICT(source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET name=excluded.name, lat=excluded.lat, lng=excluded.lng, attrs=excluded.attrs, updated_at=datetime('now')`.
- **Community-protection rule:** when the conflicting row has `confirm_count > 0` or `created_by IS NOT NULL` (a user engaged with/edited it), do **not** overwrite — log as `skipped-community`. Never touch `status`, `created_by`, `created_at`, `confirm_count`, `issue_count`, `last_verified_at`.
- Same element matching multiple categories (e.g. motorhome_stopover → vanlife + overnight-parking) → one place row, several `place_categories` rows, not duplicates.
- Cross-category duplicates at different coordinates are out of scope here (runtime duplicate detection is the API's job, CONTRACTS §6).

### 3.5 CLI & modes

```
node scripts/import-osm.ts [--city=istanbul|all] [--cat=drinking-water|all]
  [--max-per-city=500] [--dry-run] [--endpoint=URL] [--no-cache]
  [--sunset-from-viewpoints]
```

- **`--dry-run`**: fetch + map, print per city/category counts and 3 sample mapped rows; **zero DB writes**.
- **`--max-per-city`** (per-category cap, default 500): deterministic — sort elements by `(type,id)` and take the first N. Prevents `drinking-water`/`bbq-picnic` from flooding a city. Log `capped` counts so the limit is visible.
- **Report**: after each run print a table `city × category → fetched / mapped / inserted / updated / skipped / capped / errors`, and write the same to `app/db/import-report.json` for inspection.
- Exit code ≠ 0 if any query failed after retries (so CI/cron notices), but **continue with remaining queries** — partial success is fine for seeding.

---

## 4. Categories OSM cannot cover well — curated strategy

`arm-wrestling` (0 OSM objects), `sunset-spots` (no tag), `photo-spots` (83 objects), and effectively `powerlifting` (9 objects) need **hand-curated seeds with `source='curated'`** (in `scripts/seed.ts`, per CONTRACTS §7: ~20 curated showcase places with real sourced info) plus community contributions as the long-term source of truth.

**Verified example venues** (checked against public web pages **this turn**; coordinates still need manual geocoding/confirmation at seed time — do not insert unverified lat/lng):

- **Armagh Geddon Arm Wrestling Club** — weekly training Tuesdays 18:30 at The Bodyworks Gym, Armagh, Northern Ireland — <http://www.northernirelandarmwrestling.co.uk/>
- **Gegns Gym, San Diego** — armwrestling classes, workshops and competitions — <https://gegnsgym.com/armwrestling-events/>
- **PAA UK & Ireland club directory** (several seedable clubs with addresses, e.g. Kernow Armwrestlers at Kernow gym, Unicorn House, Wilson Way, Redruth TR15 3RT; Liverpool Armwrestling in Upton, Wirral; East Coast Armwrestling in Mablethorpe; Elite Assassins in Sheffield) — <https://www.paa-armwrestling.com/clubs>

For `sunset-spots`/`photo-spots` no venues are listed here — none were verified this turn; recommendation stands to curate them manually (well-known public viewpoints with west-facing aspects) rather than invent entries.

---

## 5. Non-OSM datasets worth considering later (brief)

| Source | What it has | License caveat |
|---|---|---|
| **park4night** | The largest vanlife/overnight-parking database | **Proprietary — do not scrape/import.** No public open license or official API; third-party scraping requires login session handling ([example scraper repo](https://github.com/rown89/p4n-scraper)) and almost certainly violates ToS. Partnership/data-sharing only. |
| **iOverlander** | Overland/vanlife spots, community-maintained; app is open source | Database reuse terms **(unverified)** this turn — contact maintainers before any use. |
| **Municipal open data portals** (Berlin, Barcelona, London, NYC, etc.) | Park fitness equipment, drinking fountains, BBQ/picnic areas, beach facilities — often high-quality for exactly our categories | Typically CC-BY / CC0 / national open licenses, but **per-dataset checks required** (specific datasets **(unverified)** this turn). Attribution strings differ per city — store per-dataset attribution in `source_ref`/`description` if used. |
| **Wikidata** | Named POIs with coordinates (clubs, venues) for curated categories | CC0 (widely documented; **not re-verified this turn**). Useful for arm-wrestling club seeding via SPARQL. |
| **calisthenics-parks.com** | Specialist calisthenics map (linked from the OSM wiki as a related project) | License **(unverified)**; treat as community-knowledge reference, not an import source. |

---

## 6. Definition-of-done hooks for the Backend agent

- `npm run import:osm -- --dry-run --city=berlin` prints the report table with **zero DB writes**.
- Two consecutive full runs produce **zero new duplicates** (second run = all `updated`/`skipped`).
- Every imported row has `source='osm'`, non-null `source_ref`, and every `attrs` key validates against `category_attributes` (CONTRACTS §6 validation rule applies to imports too).
- UI shows "© OpenStreetMap contributors" linking to <https://www.openstreetmap.org/copyright> wherever OSM-sourced places render.
