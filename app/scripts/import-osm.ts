// Nerde OSM import (`npm run import:osm` → `node scripts/import-osm.ts`).
// Implements the pipeline specced in DATA_SOURCES.md §3: per-category Overpass
// QL from §1, 12 city bboxes from §3.1, OSM tag → category/attr mapping per the
// §1 tables, source_ref-anchored idempotent upserts (§3.4), sequential rate-
// limited requests with an identifying User-Agent (§2.2), and a report table
// + db/import-report.json (§3.5).
//
// Quality rules honoured throughout:
//   * never invent booleans — attrs are set only when an OSM source tag exists;
//   * lifecycle-prefixed (disused:*/abandoned:*) elements are skipped;
//   * access=private|customers is skipped for public-amenity categories;
//   * every attrs key is validated against category_attributes before writing.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { APP_ROOT, getDb } from '../server/db.ts'
import { slugify } from '../server/validate.ts'

// ── Types ────────────────────────────────────────────────────────────────────

interface CityDef {
  slug: string
  city: string
  region: string
  country: string
  countryCode: string
  /** [S, W, N, E] — Overpass bbox order is south,west,north,east (§3.1). */
  bbox: [number, number, number, number]
}

interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

interface MappedPlace {
  categories: string[]
  attrs: Record<string, string | number | boolean>
  notes: string[]
  fallbackName: string
}

interface QueryDef {
  id: string
  /** Categories this query can produce (before --category filtering). */
  categories: string[]
  ql: string
  map: (tags: Record<string, string>, sunsetFromViewpoints: boolean) => MappedPlace | null
}

interface RowData {
  slug: string
  name: string
  description: string
  lat: number
  lng: number
  city: string
  region: string
  country: string
  countryCode: string
  attrs: Record<string, string | number | boolean>
  sourceRef: string
  categories: string[]
}

interface ReportRow {
  city: string
  categories: string
  fetched: number
  mapped: number
  inserted: number
  updated: number
  skipped: number
  capped: number
  errors: number
  errorMessage?: string
}

// ── Configuration ────────────────────────────────────────────────────────────

const CITIES: CityDef[] = [
  { slug: 'istanbul', city: 'Istanbul', region: 'Istanbul', country: 'Türkiye', countryCode: 'TR', bbox: [40.82, 28.55, 41.3, 29.45] },
  { slug: 'berlin', city: 'Berlin', region: 'Berlin', country: 'Germany', countryCode: 'DE', bbox: [52.34, 13.1, 52.67, 13.76] },
  { slug: 'barcelona', city: 'Barcelona', region: 'Catalonia', country: 'Spain', countryCode: 'ES', bbox: [41.32, 2.06, 41.47, 2.23] },
  { slug: 'munich', city: 'Munich', region: 'Bavaria', country: 'Germany', countryCode: 'DE', bbox: [48.06, 11.36, 48.25, 11.72] },
  { slug: 'london', city: 'London', region: 'England', country: 'United Kingdom', countryCode: 'GB', bbox: [51.29, -0.51, 51.69, 0.33] },
  { slug: 'amsterdam', city: 'Amsterdam', region: 'North Holland', country: 'Netherlands', countryCode: 'NL', bbox: [52.29, 4.74, 52.43, 5.07] },
  { slug: 'new-york', city: 'New York', region: 'New York', country: 'United States', countryCode: 'US', bbox: [40.5, -74.26, 40.92, -73.69] },
  { slug: 'san-francisco', city: 'San Francisco', region: 'California', country: 'United States', countryCode: 'US', bbox: [37.71, -122.51, 37.83, -122.36] },
  { slug: 'los-angeles', city: 'Los Angeles', region: 'California', country: 'United States', countryCode: 'US', bbox: [33.7, -118.67, 34.34, -118.16] },
  { slug: 'sydney', city: 'Sydney', region: 'New South Wales', country: 'Australia', countryCode: 'AU', bbox: [-34.12, 151.0, -33.7, 151.34] },
  { slug: 'tokyo', city: 'Tokyo', region: 'Tokyo', country: 'Japan', countryCode: 'JP', bbox: [35.53, 139.56, 35.82, 139.92] },
  { slug: 'sao-paulo', city: 'São Paulo', region: 'São Paulo', country: 'Brazil', countryCode: 'BR', bbox: [-23.88, -46.82, -23.36, -46.37] },
]

/** Default category set: everything DATA_SOURCES.md §1.19 rates good/sparse.
 *  Excluded: arm-wrestling (none), sunset-spots (none), powerlifting (rare),
 *  photo-spots (rare). */
const DEFAULT_CATEGORIES = [
  'calisthenics', 'outdoor-gyms', 'climbing', 'skateparks', 'parkour', 'basketball',
  'table-tennis', 'vanlife', 'overnight-parking', 'public-showers', 'drinking-water',
  'bbq-picnic', 'swimming-spots', 'viewpoints',
]

/** Overpass instances tried in order (primary first, §2.2); --endpoint pins one. */
const DEFAULT_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

const CACHE_DIR = path.join(APP_ROOT, 'db', 'overpass-cache')
const REPORT_PATH = path.join(APP_ROOT, 'db', 'import-report.json')

// ── Shared OSM key → attr rules (§1 "Shared OSM key → Nerde attribute rules") ─

type Attrs = Record<string, string | number | boolean>

/** fee=no/donation → free:true; fee=yes → free:false; absent → unset. */
function mapFee(tags: Record<string, string>, slug: string, attrs: Attrs): void {
  const v = tags.fee
  if (v === 'no' || v === 'donation') attrs[`${slug}.free`] = true
  else if (v === 'yes') attrs[`${slug}.free`] = false
}

/** opening_hours=24/7 → access_24_7:true; any other value → unset. */
function map247(tags: Record<string, string>, slug: string, attrs: Attrs): void {
  if (tags.opening_hours === '24/7') attrs[`${slug}.access_24_7`] = true
}

/** lit=yes|24/7 → lighting:true; lit=no|disused → false; absent → unset. */
function mapLit(tags: Record<string, string>, slug: string, attrs: Attrs): void {
  const v = tags.lit
  if (v === 'yes' || v === '24/7') attrs[`${slug}.lighting`] = true
  else if (v === 'no' || v === 'disused') attrs[`${slug}.lighting`] = false
}

/** charge=* → leading float (currency not normalized in v1). */
function parseCharge(tags: Record<string, string>): number | null {
  const m = /^([0-9]+(?:\.[0-9]+)?)/.exec((tags.charge ?? '').trim())
  return m ? Number(m[1]) : null
}

/** Semicolon-aware multi-sport match (§1 reading guide). */
function sportHas(tags: Record<string, string>, value: string): boolean {
  return (tags.sport ?? '').split(';').map((s) => s.trim()).includes(value)
}

/** Parse "6" → 6 and ranges like "0-2" → max (basketball hoops rule, §1.8). */
function parseNumberMax(value: string | undefined): number | null {
  if (!value) return null
  const parts = value.split('-').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  return parts.length > 0 ? Math.max(...parts) : null
}

/** 'yes'|'limited'|'<count>' are all truthy for climbing sub-tags (§1.5). */
function osmTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== 'no'
}

/** fitness_station values: primary tag (;-lists) + fitness_station:<type>=yes. */
function fitnessEquipment(tags: Record<string, string>): string[] {
  const out = new Set<string>()
  for (const v of (tags.fitness_station ?? '').split(';')) {
    const t = v.trim()
    if (t) out.add(t)
  }
  for (const [k, v] of Object.entries(tags)) {
    if (k.startsWith('fitness_station:') && v === 'yes') out.add(k.slice('fitness_station:'.length))
  }
  return [...out]
}

const humanizeOsmValue = (v: string): string => v.replace(/_/g, ' ')

// ── Viewpoint direction parsing (§1.16) ──────────────────────────────────────

const COMPASS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
}

function directionValue(token: string): number | null {
  const t = token.trim().toUpperCase()
  if (t in COMPASS) return COMPASS[t]
  const n = Number(t)
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : null
}

/** direction=* → list of [start,end] degree arcs (end may exceed 360). */
function parseDirectionRanges(raw: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const token of raw.split(/[;,]/)) {
    const t = token.trim()
    if (!t) continue
    const dash = t.indexOf('-')
    if (dash > 0) {
      const a = directionValue(t.slice(0, dash))
      const b = directionValue(t.slice(dash + 1))
      if (a !== null && b !== null) ranges.push(b >= a ? [a, b] : [a, b + 360])
      continue
    }
    const d = directionValue(t)
    // A single direction value ≈ a ±45° viewing arc (documented heuristic).
    if (d !== null) ranges.push([d - 45, d + 45])
  }
  return ranges
}

function arcsIntersect(ranges: Array<[number, number]>, lo: number, hi: number): boolean {
  return ranges.some(([a, b]) => {
    const start = ((a % 360) + 360) % 360
    const len = b - a
    return (start <= hi && start + len >= lo) || (start <= hi + 360 && start + len >= lo + 360)
  })
}

/** Sunset arc 240°–300° (WSW–WNW), sunrise arc 60°–120° (§1.16). */
function directionFacing(raw: string | undefined): { sunset: boolean; sunrise: boolean } | null {
  if (!raw) return null
  const ranges = parseDirectionRanges(raw)
  if (ranges.length === 0) return null
  return { sunset: arcsIntersect(ranges, 240, 300), sunrise: arcsIntersect(ranges, 60, 120) }
}

// ── Per-category mappers (§1 tables — attrs only from tags actually present) ──

/** §1.1/§1.3 — shared fitness_station query, classified into calisthenics
 *  (sport=calisthenics or bar-type equipment) and/or outdoor-gyms. */
function mapFitness(tags: Record<string, string>): MappedPlace {
  const equipment = fitnessEquipment(tags)
  const barTypes = ['horizontal_bar', 'parallel_bars', 'rings', 'horizontal_ladder', 'wall_bars']
  const isCalisthenics = sportHas(tags, 'calisthenics') || equipment.some((e) => barTypes.includes(e))
  const categories = isCalisthenics ? ['calisthenics', 'outdoor-gyms'] : ['outdoor-gyms']
  const attrs: Attrs = {}
  for (const slug of categories) {
    mapFee(tags, slug, attrs)
    map247(tags, slug, attrs)
    mapLit(tags, slug, attrs)
  }
  if (equipment.length > 0) attrs['outdoor-gyms.equipment'] = equipment.map(humanizeOsmValue).join(', ')
  if (isCalisthenics) {
    if (equipment.includes('horizontal_bar')) attrs['calisthenics.pull_up_bars'] = true
    if (equipment.includes('parallel_bars')) attrs['calisthenics.parallel_bars'] = true
    if (equipment.includes('dip_bench') || equipment.includes('captains_chair')) attrs['calisthenics.dip_bars'] = true
    if (equipment.includes('horizontal_ladder')) attrs['calisthenics.monkey_bars'] = true
    if (equipment.includes('rings')) attrs['calisthenics.rings'] = true
    if (tags.surface) {
      attrs['calisthenics.ground_surface'] = ['rubber', 'concrete', 'grass', 'sand'].includes(tags.surface)
        ? tags.surface
        : 'mixed'
    }
    // Fitness stations are outdoor by definition (§1.1).
    attrs['calisthenics.indoor_outdoor'] = tags.indoor === 'yes' ? 'indoor' : 'outdoor'
  }
  return { categories, attrs, notes: [], fallbackName: isCalisthenics ? 'Calisthenics park' : 'Fitness station' }
}

/** §1.5 — climbing / bouldering. */
function mapClimbing(tags: Record<string, string>): MappedPlace {
  const attrs: Attrs = {}
  mapFee(tags, 'climbing', attrs)
  if (tags.climbing === 'boulder' || osmTruthy(tags['climbing:boulder'])) attrs['climbing.bouldering'] = true
  else if (tags['climbing:boulder'] === 'no') attrs['climbing.bouldering'] = false
  const rope = [tags['climbing:sport'], tags['climbing:toprope'], tags['climbing:trad']]
  if (rope.some(osmTruthy)) attrs['climbing.rope_climbing'] = true
  if (tags['climbing:rock']) {
    attrs['climbing.rock_type'] = ['granite', 'limestone', 'sandstone'].includes(tags['climbing:rock'])
      ? tags['climbing:rock']
      : 'other'
  }
  const indoor =
    tags.indoor === 'yes' ||
    (['sports_hall', 'sports_centre'].includes(tags.leisure ?? '') && 'building' in tags)
  attrs['climbing.indoor_outdoor'] = indoor ? 'indoor' : 'outdoor'
  return { categories: ['climbing'], attrs, notes: [], fallbackName: 'Climbing spot' }
}

/** §1.6 — skateparks. */
function mapSkatepark(tags: Record<string, string>): MappedPlace {
  const attrs: Attrs = {}
  mapFee(tags, 'skateparks', attrs)
  mapLit(tags, 'skateparks', attrs)
  if (tags.surface && ['concrete', 'wood', 'metal'].includes(tags.surface)) {
    attrs['skateparks.surface'] = tags.surface
  }
  if (tags['skatepark:bowl'] === 'yes') attrs['skateparks.bowl'] = true
  if (tags['skatepark:street'] === 'yes') attrs['skateparks.street_section'] = true
  attrs['skateparks.indoor_outdoor'] = tags.indoor === 'yes' ? 'indoor' : 'outdoor'
  return { categories: ['skateparks'], attrs, notes: [], fallbackName: 'Skatepark' }
}

/** §1.7 — parkour. */
function mapParkour(tags: Record<string, string>): MappedPlace {
  const attrs: Attrs = {}
  mapFee(tags, 'parkour', attrs)
  mapLit(tags, 'parkour', attrs)
  map247(tags, 'parkour', attrs)
  attrs['parkour.indoor_outdoor'] = tags.indoor === 'yes' ? 'indoor' : 'outdoor'
  return { categories: ['parkour'], attrs, notes: [], fallbackName: 'Parkour spot' }
}

/** §1.8 — basketball. */
function mapBasketball(tags: Record<string, string>): MappedPlace {
  const attrs: Attrs = {}
  mapFee(tags, 'basketball', attrs)
  mapLit(tags, 'basketball', attrs)
  const hoops = parseNumberMax(tags.hoops)
  if (hoops !== null) attrs['basketball.hoops'] = hoops
  if (tags['hoops:nets'] === 'none') attrs['basketball.nets'] = false
  else if (tags['hoops:nets'] === 'chord' || tags['hoops:nets'] === 'chain') attrs['basketball.nets'] = true
  const surfaceMap: Record<string, string> = {
    asphalt: 'asphalt', concrete: 'concrete', wood: 'wood', parquet: 'wood',
    tartan: 'synthetic', acrylic: 'synthetic', synthetic: 'synthetic',
  }
  if (tags.surface && surfaceMap[tags.surface]) attrs['basketball.surface'] = surfaceMap[tags.surface]
  attrs['basketball.indoor_outdoor'] = tags.indoor === 'yes' ? 'indoor' : 'outdoor'
  return { categories: ['basketball'], attrs, notes: [], fallbackName: 'Basketball court' }
}

/** §1.9 — table tennis (capacity = number of tables; absent stays unset). */
function mapTableTennis(tags: Record<string, string>): MappedPlace {
  const attrs: Attrs = {}
  mapFee(tags, 'table-tennis', attrs)
  mapLit(tags, 'table-tennis', attrs)
  const tables = parseNumberMax(tags.capacity)
  if (tables !== null) attrs['table-tennis.tables'] = tables
  attrs['table-tennis.indoor_outdoor'] = tags.indoor === 'yes' ? 'indoor' : 'outdoor'
  return { categories: ['table-tennis'], attrs, notes: [], fallbackName: 'Table tennis table' }
}

/** §1.10/§1.11 — vanlife; motorhome_stopover is dual-tagged overnight-parking. */
function mapVanlife(tags: Record<string, string>): MappedPlace {
  const isCaravanSite = tags.tourism === 'caravan_site'
  const isDumpStation = tags.amenity === 'sanitary_dump_station'
  const isWaterPoint = tags.amenity === 'water_point'
  const isStopover = tags.caravan_site === 'motorhome_stopover'
  const categories = ['vanlife']
  if (isCaravanSite && isStopover) categories.push('overnight-parking')
  const attrs: Attrs = {}
  const notes: string[] = []
  // caravan_site is overnight-by-definition; dump/water points are service
  // points, NOT sleeping spots → overnight_allowed stays unset for them.
  if (isCaravanSite) attrs['vanlife.overnight_allowed'] = true
  if (isDumpStation) attrs['vanlife.waste_disposal'] = true
  if (isWaterPoint) attrs['vanlife.drinking_water'] = true
  if (isDumpStation || isWaterPoint) notes.push('Service point — not an overnight spot')
  mapFee(tags, 'vanlife', attrs)
  if (tags.toilets === 'yes') attrs['vanlife.toilet'] = true
  else if (tags.toilets === 'no') attrs['vanlife.toilet'] = false
  if (tags.shower === 'yes') attrs['vanlife.shower'] = true
  if (tags.drinking_water === 'yes' || tags.water_point === 'yes') attrs['vanlife.drinking_water'] = true
  if (tags.power_supply === 'yes') attrs['vanlife.electricity'] = true
  if (tags.sanitary_dump_station === 'yes') attrs['vanlife.waste_disposal'] = true
  const maxLength = parseNumberMax(tags.maxlength)
  if (maxLength !== null) attrs['vanlife.max_vehicle_length'] = maxLength
  if (tags.maxstay) notes.push(`Max stay: ${tags.maxstay}`)
  if (categories.includes('overnight-parking')) {
    attrs['overnight-parking.overnight_allowed'] = true
    mapFee(tags, 'overnight-parking', attrs)
  }
  const fallbackName = isCaravanSite
    ? isStopover ? 'Motorhome stopover' : 'Caravan site'
    : isDumpStation ? 'Sanitary dump station' : 'Water point'
  return { categories, attrs, notes, fallbackName }
}

/** §1.12 — public showers (skips access=private|customers). */
function mapShower(tags: Record<string, string>): MappedPlace | null {
  if (tags.access === 'private' || tags.access === 'customers') return null
  const attrs: Attrs = {}
  const notes: string[] = []
  mapFee(tags, 'public-showers', attrs)
  map247(tags, 'public-showers', attrs)
  if (tags.hot_water === 'yes') attrs['public-showers.hot_water'] = true
  else if (tags.hot_water === 'no') attrs['public-showers.hot_water'] = false
  else if (tags.hot_water === 'fee') {
    attrs['public-showers.hot_water'] = true
    notes.push('Hot water for a fee')
  }
  if (tags.indoor === 'yes') attrs['public-showers.indoor_outdoor'] = 'indoor'
  else if (tags.outdoor === 'yes') attrs['public-showers.indoor_outdoor'] = 'outdoor'
  const price = parseCharge(tags)
  if (price !== null) attrs['public-showers.price'] = price
  return { categories: ['public-showers'], attrs, notes, fallbackName: 'Public shower' }
}

/** §1.13 — drinking water (potable-by-definition; skips non-public access). */
function mapDrinkingWater(tags: Record<string, string>): MappedPlace | null {
  if (tags.access === 'private' || tags.access === 'customers') return null
  const attrs: Attrs = { 'drinking-water.potable_confirmed': true }
  mapFee(tags, 'drinking-water', attrs)
  map247(tags, 'drinking-water', attrs)
  if (tags.seasonal === 'yes') attrs['drinking-water.seasonal'] = true
  else if (tags.seasonal === 'no') attrs['drinking-water.seasonal'] = false
  return { categories: ['drinking-water'], attrs, notes: [], fallbackName: 'Drinking water' }
}

/** §1.14 — bbq & picnic (skips non-public access). */
function mapBbqPicnic(tags: Record<string, string>): MappedPlace | null {
  if (tags.access === 'private' || tags.access === 'customers') return null
  const attrs: Attrs = {}
  const notes: string[] = []
  const isBbq = tags.amenity === 'bbq'
  const isPicnicSite = tags.tourism === 'picnic_site'
  if (isBbq) attrs['bbq-picnic.bbq_grill'] = true
  if (tags.bbq === 'yes') attrs['bbq-picnic.bbq_grill'] = true
  else if (tags.bbq === 'bring_your_own') {
    attrs['bbq-picnic.bbq_grill'] = false
    notes.push('Bring your own grill')
  }
  if (tags.firepit === 'yes' || tags.openfire === 'yes' || tags.leisure === 'firepit') {
    attrs['bbq-picnic.fire_allowed'] = true
  }
  if (tags.leisure === 'picnic_table' || tags.picnic_table === 'yes') attrs['bbq-picnic.tables'] = true
  if (tags.drinking_water === 'yes') attrs['bbq-picnic.drinking_water'] = true
  mapFee(tags, 'bbq-picnic', attrs)
  const fallbackName = isBbq ? 'BBQ area' : isPicnicSite ? 'Picnic site' : 'Picnic table'
  return { categories: ['bbq-picnic'], attrs, notes, fallbackName }
}

/** §1.15 — swimming spots. */
function mapSwimming(tags: Record<string, string>): MappedPlace {
  const attrs: Attrs = {}
  const notes: string[] = []
  const isBeach = tags.natural === 'beach'
  if (isBeach) {
    // Coastal-beach heuristic, marked derived per §1.15.
    attrs['swimming-spots.water_type'] = 'sea'
    attrs['swimming-spots.entry_type'] = 'beach'
    notes.push('Water type derived from natural=beach (heuristic)')
  }
  if (tags.lifeguard === 'yes') attrs['swimming-spots.lifeguard'] = true
  else if (tags.lifeguard === 'no') attrs['swimming-spots.lifeguard'] = false
  mapFee(tags, 'swimming-spots', attrs)
  const fallbackName = isBeach ? 'Beach swim spot' : tags.leisure === 'bathing_place' ? 'Bathing place' : 'Swimming area'
  return { categories: ['swimming-spots'], attrs, notes, fallbackName }
}

/** §1.16/§1.17 — viewpoints (+ optional sunset-spots derivation behind flag). */
function mapViewpoint(tags: Record<string, string>, sunsetFromViewpoints: boolean): MappedPlace {
  const attrs: Attrs = {}
  const notes: string[] = []
  mapFee(tags, 'viewpoints', attrs)
  map247(tags, 'viewpoints', attrs)
  const facing = directionFacing(tags.direction)
  if (facing && (facing.sunset || facing.sunrise)) {
    if (facing.sunset) attrs['viewpoints.sunset_facing'] = true
    if (facing.sunrise) attrs['viewpoints.sunrise_facing'] = true
    notes.push('Facing derived from OSM direction tag (heuristic)')
  }
  const categories = ['viewpoints']
  if (sunsetFromViewpoints && facing?.sunset) {
    categories.push('sunset-spots')
    attrs['sunset-spots.west_facing'] = true
    notes.push('Also tagged as sunset spot (--sunset-from-viewpoints heuristic)')
  }
  return { categories, attrs, notes, fallbackName: 'Viewpoint' }
}

// ── Query definitions (QL verbatim from DATA_SOURCES §1) ─────────────────────

const QL_HEAD = '[out:json][timeout:60];\n'
const QL_TAIL = 'out center;'

const QUERIES: QueryDef[] = [
  {
    id: 'fitness',
    categories: ['calisthenics', 'outdoor-gyms'],
    ql: `${QL_HEAD}(\n  nwr["leisure"="fitness_station"]({{bbox}});\n  nwr["sport"~"(^|;) *calisthenics *(;|$)"]({{bbox}});\n);\n${QL_TAIL}`,
    map: (tags) => mapFitness(tags),
  },
  {
    id: 'climbing',
    categories: ['climbing'],
    ql: `${QL_HEAD}(\n  nwr["sport"="climbing"]({{bbox}});\n  nwr["climbing"~"^(boulder|crag|area)$"]({{bbox}});\n);\n${QL_TAIL}`,
    map: (tags) => mapClimbing(tags),
  },
  {
    id: 'skateparks',
    categories: ['skateparks'],
    ql: `${QL_HEAD}(\n  nwr["leisure"="pitch"]["sport"~"(^|;) *skateboard *(;|$)"]({{bbox}});\n  nwr["leisure"="skatepark"]({{bbox}});\n);\n${QL_TAIL}`,
    map: (tags) => mapSkatepark(tags),
  },
  {
    id: 'parkour',
    categories: ['parkour'],
    ql: `${QL_HEAD}nwr["sport"~"(^|;) *parkour *(;|$)"]({{bbox}});\n${QL_TAIL}`,
    map: (tags) => mapParkour(tags),
  },
  {
    id: 'basketball',
    categories: ['basketball'],
    ql: `${QL_HEAD}nwr["leisure"="pitch"]["sport"~"(^|;) *basketball *(;|$)"]({{bbox}});\n${QL_TAIL}`,
    map: (tags) => mapBasketball(tags),
  },
  {
    id: 'table-tennis',
    categories: ['table-tennis'],
    ql: `${QL_HEAD}nwr["leisure"="pitch"]["sport"~"(^|;) *table_tennis *(;|$)"]({{bbox}});\n${QL_TAIL}`,
    map: (tags) => mapTableTennis(tags),
  },
  {
    id: 'vanlife',
    categories: ['vanlife', 'overnight-parking'],
    ql: `${QL_HEAD}(\n  nwr["tourism"="caravan_site"]({{bbox}});\n  nwr["amenity"="sanitary_dump_station"]({{bbox}});\n  nwr["amenity"="water_point"]({{bbox}});\n);\n${QL_TAIL}`,
    map: (tags) => mapVanlife(tags),
  },
  {
    // §1.11 — narrow subset of the vanlife query; only run when the vanlife
    // query is NOT selected (its mapper already dual-tags stopovers).
    id: 'overnight-parking',
    categories: ['overnight-parking', 'vanlife'],
    ql: `${QL_HEAD}nwr["tourism"="caravan_site"]["caravan_site"="motorhome_stopover"]({{bbox}});\n${QL_TAIL}`,
    map: (tags) => mapVanlife(tags),
  },
  {
    id: 'public-showers',
    categories: ['public-showers'],
    ql: `${QL_HEAD}nwr["amenity"="shower"]({{bbox}});\n${QL_TAIL}`,
    map: (tags) => mapShower(tags),
  },
  {
    id: 'drinking-water',
    categories: ['drinking-water'],
    ql: `${QL_HEAD}nwr["amenity"="drinking_water"]({{bbox}});\n${QL_TAIL}`,
    map: (tags) => mapDrinkingWater(tags),
  },
  {
    id: 'bbq-picnic',
    categories: ['bbq-picnic'],
    ql: `${QL_HEAD}(\n  nwr["amenity"="bbq"]({{bbox}});\n  nwr["tourism"="picnic_site"]({{bbox}});\n  nwr["leisure"="picnic_table"]({{bbox}});\n);\n${QL_TAIL}`,
    map: (tags) => mapBbqPicnic(tags),
  },
  {
    id: 'swimming-spots',
    categories: ['swimming-spots'],
    ql: `${QL_HEAD}(\n  nwr["leisure"="swimming_area"]({{bbox}});\n  nwr["leisure"="bathing_place"]({{bbox}});\n  nwr["natural"="beach"]["sport"~"(^|;) *swimming *(;|$)"]({{bbox}});\n);\n${QL_TAIL}`,
    map: (tags) => mapSwimming(tags),
  },
  {
    id: 'viewpoints',
    categories: ['viewpoints'],
    ql: `${QL_HEAD}nwr["tourism"="viewpoint"]({{bbox}});\n${QL_TAIL}`,
    map: (tags, sunset) => mapViewpoint(tags, sunset),
  },
]

// ── CLI ──────────────────────────────────────────────────────────────────────

interface CliOptions {
  cities: CityDef[]
  categories: string[]
  maxPerCity: number
  dryRun: boolean
  endpoints: string[]
  noCache: boolean
  sunsetFromViewpoints: boolean
}

function parseCli(argv: string[]): CliOptions {
  const flags = new Map<string, string>()
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg)
    if (m) flags.set(m[1], m[2] ?? 'true')
  }
  if (flags.has('help')) {
    console.log(`Usage: node scripts/import-osm.ts [options]

Options:
  --city=istanbul|all        City slug or name (default: all 12 cities)
  --category=slug|all        Category slug, repeatable via commas (default: good/sparse set)
  --cat=slug                 Alias of --category
  --limit=N                  Alias of --max-per-city
  --max-per-city=N           Per-city per-category cap (default: 2000, deterministic)
  --dry-run                  Fetch + map + print, ZERO DB writes
  --endpoint=URL             Pin a single Overpass instance
  --no-cache                 Bypass the on-disk response cache
  --sunset-from-viewpoints   Also tag west-facing viewpoints as sunset-spots (heuristic)
  --help                     This message`)
    process.exit(0)
  }

  let cities = CITIES
  const cityArg = flags.get('city')
  if (cityArg && cityArg !== 'all') {
    const needle = cityArg.trim().toLowerCase()
    cities = CITIES.filter((c) => c.slug === needle || c.city.toLowerCase() === needle)
    if (cities.length === 0) {
      console.error(`Unknown --city="${cityArg}". Known: ${CITIES.map((c) => c.slug).join(', ')}`)
      process.exit(2)
    }
  }

  let categories = DEFAULT_CATEGORIES
  const catArg = flags.get('category') ?? flags.get('cat')
  if (catArg && catArg !== 'all') {
    categories = catArg.split(',').map((s) => s.trim()).filter(Boolean)
  }

  const maxPerCity = Number(flags.get('max-per-city') ?? flags.get('limit') ?? 2000)
  if (!Number.isFinite(maxPerCity) || maxPerCity < 1) {
    console.error('--max-per-city/--limit must be a positive integer')
    process.exit(2)
  }

  const endpoint = flags.get('endpoint')
  return {
    cities,
    categories,
    maxPerCity: Math.floor(maxPerCity),
    dryRun: flags.has('dry-run'),
    endpoints: endpoint ? [endpoint] : DEFAULT_ENDPOINTS,
    noCache: flags.has('no-cache'),
    sunsetFromViewpoints: flags.has('sunset-from-viewpoints'),
  }
}

// ── Overpass fetch: cache + sequential rate-limit + failover + backoff ────────

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let lastNetworkAt = 0
let lastGoodEndpointIdx = 0

async function fetchOverpass(ql: string, opts: CliOptions): Promise<OsmElement[]> {
  const email = process.env.NERDE_OSM_ATTRIBUTION_EMAIL ?? 'hello@example.com'
  const userAgent = `NerdeOSMImport/0.1 (contact: ${email})`
  const cacheKey = createHash('sha1').update(`${opts.endpoints.join(',')}\n${ql}`).digest('hex')
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`)
  if (!opts.noCache && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as { elements?: OsmElement[] }
    return cached.elements ?? []
  }

  // Politeness: ≥3 s between network requests, strictly sequential (§2.2).
  const waitMs = 3000 - (Date.now() - lastNetworkAt)
  if (lastNetworkAt > 0 && waitMs > 0) await sleep(waitMs)

  const backoffs = [30_000, 60_000, 120_000] // §2.2, after a full endpoint rotation
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const idx = (lastGoodEndpointIdx + attempt) % opts.endpoints.length
    const endpoint = opts.endpoints[idx]
    // A full rotation failed → back off before re-hitting the same instance.
    if (attempt >= opts.endpoints.length) {
      const pause = backoffs[Math.min(attempt - opts.endpoints.length, backoffs.length - 1)]
      console.log(`    all endpoints failed; backing off ${pause / 1000}s before retry…`)
      await sleep(pause)
    }
    try {
      lastNetworkAt = Date.now()
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': userAgent },
        body: `data=${encodeURIComponent(ql)}`,
        signal: AbortSignal.timeout(150_000),
      })
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${endpoint}`)
        console.log(`    ${endpoint} → HTTP ${res.status}; trying next endpoint…`)
        continue
      }
      const body = (await res.json()) as { elements?: OsmElement[] }
      lastGoodEndpointIdx = idx
      if (!opts.noCache) {
        fs.mkdirSync(CACHE_DIR, { recursive: true })
        fs.writeFileSync(cacheFile, JSON.stringify(body))
      }
      return body.elements ?? []
    } catch (err) {
      lastError = err as Error
      console.log(`    ${endpoint} → ${lastError.message}; trying next endpoint…`)
    }
  }
  throw lastError ?? new Error('overpass request failed')
}

// ── Element → row mapping ────────────────────────────────────────────────────

function elementCoords(el: OsmElement): { lat: number; lng: number } | null {
  if (el.type === 'node') {
    return typeof el.lat === 'number' && typeof el.lon === 'number' ? { lat: el.lat, lng: el.lon } : null
  }
  // ways/relations: `out center` provides center.lat/center.lon (§1 reading guide)
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    return { lat: el.center.lat, lng: el.center.lon }
  }
  return null
}

/** Skip lifecycle-prefixed features: relevant key present only as
 *  disused:* / abandoned:* (§3.2 step 5). */
function isLifecycleDead(tags: Record<string, string>): boolean {
  for (const key of Object.keys(tags)) {
    for (const prefix of ['disused:', 'abandoned:']) {
      if (key.startsWith(prefix)) {
        const base = key.slice(prefix.length)
        if (!(base in tags)) return true
      }
    }
  }
  return false
}

/** Deterministic 8-char base36 suffix from source_ref → stable slugs (§3.3).
 *  (Was 4 chars / 1.68M space: thousands of same-named fallback rows per city
 *  made UNIQUE places.slug collisions near-certain, rolling back whole
 *  city writes — e.g. 2000 "Drinking water" rows in Barcelona. 8 chars /
 *  2.8T space removes collisions; only affects newly inserted rows, since
 *  re-imports match on source_ref and never re-slug existing rows.) */
function refSuffix(sourceRef: string): string {
  const h = createHash('sha1').update(sourceRef).digest()
  return ((h.readUInt32BE(0) * 2 ** 32 + h.readUInt32BE(4)) % 36 ** 8).toString(36).padStart(8, '0')
}

function buildRow(el: OsmElement, mapped: MappedPlace, city: CityDef): RowData | null {
  const tags = el.tags ?? {}
  const coords = elementCoords(el)
  if (!coords) return null
  const sourceRef = `osm:${el.type}/${el.id}`
  const name = (tags.name ?? tags['name:en'] ?? mapped.fallbackName).trim().slice(0, 80) || mapped.fallbackName
  const descParts: string[] = []
  if (tags.description) descParts.push(tags.description.trim().slice(0, 400))
  descParts.push(...mapped.notes)
  descParts.push(`Data © OpenStreetMap contributors (${sourceRef})`)
  return {
    slug: `${slugify(name)}-${refSuffix(sourceRef)}`,
    name,
    description: descParts.join(' — ').slice(0, 1000),
    lat: coords.lat,
    lng: coords.lng,
    city: city.city,
    region: city.region,
    country: city.country,
    countryCode: city.countryCode,
    attrs: mapped.attrs,
    sourceRef,
    categories: mapped.categories,
  }
}

// ── Category definitions from DB (attr validity gate, §6 definition-of-done) ─

interface CatDef {
  id: number
  keys: Set<string>
}

function loadCategoryDefs(): Map<string, CatDef> {
  const db = getDb()
  const defs = new Map<string, CatDef>()
  const cats = db.prepare('SELECT id, slug FROM categories').all() as Array<{ id: number; slug: string }>
  const attrStmt = db.prepare('SELECT key FROM category_attributes WHERE category_id = ?')
  for (const c of cats) {
    defs.set(c.slug, {
      id: c.id,
      keys: new Set((attrStmt.all(c.id) as Array<{ key: string }>).map((r) => r.key)),
    })
  }
  return defs
}

/** Keep only attrs keys that are valid for the row's (filtered) categories. */
function filterAttrs(row: RowData, defs: Map<string, CatDef>): number {
  let dropped = 0
  for (const key of Object.keys(row.attrs)) {
    const dot = key.indexOf('.')
    const cat = dot > 0 ? key.slice(0, dot) : ''
    const attrKey = dot > 0 ? key.slice(dot + 1) : ''
    if (!row.categories.includes(cat) || !defs.get(cat)?.keys.has(attrKey)) {
      delete row.attrs[key]
      dropped++
    }
  }
  return dropped
}

// ── Upsert (§3.4 + DATABASE.md §8 merge policy) ──────────────────────────────

function upsertRow(row: RowData, defs: Map<string, CatDef>): 'inserted' | 'updated' | 'skipped' {
  const db = getDb()
  const existing = db
    .prepare('SELECT id, confirm_count, created_by FROM places WHERE source_ref = ?')
    .get(row.sourceRef) as { id: number; confirm_count: number; created_by: number | null } | undefined

  // Community-protection rule (§3.4): never overwrite rows a user engaged with.
  if (existing && (existing.confirm_count > 0 || existing.created_by !== null)) return 'skipped'

  const link = (placeId: number): void => {
    const stmt = db.prepare('INSERT OR IGNORE INTO place_categories (place_id, category_id) VALUES (?, ?)')
    for (const slug of row.categories) {
      const def = defs.get(slug)
      if (def) stmt.run(placeId, def.id)
    }
  }

  if (existing) {
    // Merge policy (DATABASE.md §8): refresh identity/geometry only — never
    // slug, description, attrs, status, counters, or ownership.
    db.prepare(`UPDATE places SET name = ?, lat = ?, lng = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(row.name, row.lat, row.lng, existing.id)
    link(existing.id)
    return 'updated'
  }
  const inserted = db
    .prepare(
      `INSERT INTO places (slug, name, description, lat, lng, address, city, region,
                           country, country_code, attrs, status, source, source_ref, created_by)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 'published', 'osm', ?, NULL)
       RETURNING id`,
    )
    .get(
      row.slug, row.name, row.description, row.lat, row.lng,
      row.city, row.region, row.country, row.countryCode,
      JSON.stringify(row.attrs), row.sourceRef,
    ) as { id: number }
  link(inserted.id)
  return 'inserted'
}

// ── Main pipeline ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2))
  const startedAt = new Date().toISOString()
  console.log(`Nerde OSM import — ${startedAt}`)
  console.log(
    `mode=${opts.dryRun ? 'DRY RUN (no DB writes)' : 'write'} cities=[${opts.cities.map((c) => c.slug).join(',')}] ` +
    `categories=[${opts.categories.join(',')}] max-per-city=${opts.maxPerCity} endpoints=${opts.endpoints.length}`,
  )

  const defs = loadCategoryDefs()
  if (defs.size === 0) {
    console.error('No categories found in the database — run `npm run seed` first.')
    process.exit(1)
  }
  for (const slug of opts.categories) {
    if (!defs.has(slug)) {
      console.error(`Unknown category "${slug}" — not in the database. Run \`npm run seed\` first.`)
      process.exit(2)
    }
  }

  // Query selection: category intersection + the overnight-parking subset rule.
  const selected = QUERIES.filter((q) => q.categories.some((c) => opts.categories.includes(c)))
  if (selected.some((q) => q.id === 'vanlife')) {
    const idx = selected.findIndex((q) => q.id === 'overnight-parking')
    if (idx !== -1) selected.splice(idx, 1) // subset — covered by the vanlife query
  }
  if (selected.length === 0) {
    console.error('No importable categories selected (see DATA_SOURCES.md §1.19 coverage).')
    process.exit(2)
  }

  const report: ReportRow[] = []
  const samples: string[] = []
  let hadErrors = false

  for (const city of opts.cities) {
    console.log(`\n${city.city} (${city.slug})`)
    const merged = new Map<string, { row: RowData; queryId: string }>()
    const bboxStr = city.bbox.join(',') // S,W,N,E — Overpass order (§1 reading guide)

    for (const query of selected) {
      const rep: ReportRow = {
        city: city.slug, categories: query.categories.filter((c) => opts.categories.includes(c)).join('+'),
        fetched: 0, mapped: 0, inserted: 0, updated: 0, skipped: 0, capped: 0, errors: 0,
      }
      report.push(rep)
      const ql = query.ql.replaceAll('{{bbox}}', bboxStr)
      let elements: OsmElement[]
      try {
        elements = await fetchOverpass(ql, opts)
      } catch (err) {
        rep.errors = 1
        rep.errorMessage = (err as Error).message
        hadErrors = true
        console.log(`  ✗ ${query.id}: query failed after retries — ${rep.errorMessage}`)
        continue
      }
      rep.fetched = elements.length

      // Map + filter; deterministic order (type,id) before capping (§3.5).
      const rows: Array<{ el: OsmElement; mapped: MappedPlace }> = []
      for (const el of elements) {
        if (!el.tags || isLifecycleDead(el.tags)) continue
        if (!elementCoords(el)) continue
        const mapped = query.map(el.tags, opts.sunsetFromViewpoints)
        if (!mapped) continue
        mapped.categories = mapped.categories.filter((c) => opts.categories.includes(c))
        if (mapped.categories.length === 0) continue
        rows.push({ el, mapped })
      }
      rows.sort((a, b) => `${a.el.type}/${a.el.id}`.localeCompare(`${b.el.type}/${b.el.id}`))
      const cappedRows = rows.slice(0, opts.maxPerCity)
      rep.capped = rows.length - cappedRows.length
      rep.mapped = cappedRows.length

      // Merge into the per-city map keyed by source_ref (handles shared queries
      // and cross-query duplicates like motorhome stopovers).
      for (const { el, mapped } of cappedRows) {
        const ref = `osm:${el.type}/${el.id}`
        const existing = merged.get(ref)
        if (existing) {
          existing.row.categories = [...new Set([...existing.row.categories, ...mapped.categories])]
          Object.assign(existing.row.attrs, mapped.attrs)
          for (const note of mapped.notes) {
            if (!existing.row.description.includes(note)) existing.row.description += ` — ${note}`
          }
        } else {
          const row = buildRow(el, mapped, city)
          if (row) merged.set(ref, { row, queryId: query.id })
        }
      }
      if (opts.dryRun) {
        for (const { el, mapped } of cappedRows.slice(0, 3)) {
          const coords = elementCoords(el)!
          samples.push(
            `    • [${city.slug}/${query.id}] ${(el.tags?.name ?? mapped.fallbackName).slice(0, 60)} ` +
            `(${mapped.categories.join(', ')}) @ ${coords.lat.toFixed(5)},${coords.lng.toFixed(5)} ` +
            `attrs=${JSON.stringify(mapped.attrs)}`,
          )
        }
      }
      console.log(
        `  ${rep.categories.padEnd(28)} fetched=${rep.fetched} mapped=${rep.mapped}` +
        (rep.capped > 0 ? ` capped=${rep.capped}` : ''),
      )
    }

    // Write phase (per city, one transaction) — skipped entirely in dry-run.
    if (!opts.dryRun && merged.size > 0) {
      const db = getDb()
      // Attribute write outcomes back to the report row of the query that
      // first produced each merged place.
      const queryRep = (queryId: string): ReportRow | undefined => {
        const q = QUERIES.find((x) => x.id === queryId)
        const cats = q?.categories.filter((c) => opts.categories.includes(c)).join('+')
        return [...report].reverse().find((r) => r.city === city.slug && r.categories === cats)
      }
      db.exec('BEGIN')
      try {
        for (const { row, queryId } of merged.values()) {
          filterAttrs(row, defs)
          const outcome = upsertRow(row, defs)
          const rep = queryRep(queryId)
          if (rep) rep[outcome]++
        }
        db.exec('COMMIT')
      } catch (err) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // already rolled back
        }
        throw err
      }
      console.log(`  → wrote ${merged.size} place(s)`)
    } else if (opts.dryRun) {
      console.log(`  → dry run: ${merged.size} place(s) NOT written`)
    }
  }

  // ── Report ──
  console.log('\n── Report (city × category) ─────────────────────────────────────────────')
  const head = ['city', 'categories', 'fetched', 'mapped', 'inserted', 'updated', 'skipped', 'capped', 'errors']
  console.log(head.map((h) => h.padEnd(14)).join(''))
  for (const r of report) {
    console.log(
      [r.city, r.categories, r.fetched, r.mapped, r.inserted, r.updated, r.skipped, r.capped, r.errors]
        .map((v) => String(v).padEnd(14))
        .join(''),
    )
  }
  const totals = new Map<string, { inserted: number; updated: number; skipped: number; mapped: number }>()
  for (const r of report) {
    for (const cat of r.categories.split('+')) {
      const t = totals.get(cat) ?? { inserted: 0, updated: 0, skipped: 0, mapped: 0 }
      t.mapped += r.mapped
      t.inserted += r.inserted
      t.updated += r.updated
      t.skipped += r.skipped
      totals.set(cat, t)
    }
  }
  console.log('\n── Per-category totals ────────────────────────────────────────────────────')
  for (const [cat, t] of [...totals.entries()].sort()) {
    console.log(`  ${cat.padEnd(20)} mapped=${t.mapped} inserted=${t.inserted} updated=${t.updated} skipped-community=${t.skipped}`)
  }
  if (samples.length > 0) {
    console.log('\n── Dry-run samples (max 3 per city×query) ───────────────────────────────')
    for (const s of samples) console.log(s)
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        dryRun: opts.dryRun,
        options: {
          cities: opts.cities.map((c) => c.slug),
          categories: opts.categories,
          maxPerCity: opts.maxPerCity,
          endpoints: opts.endpoints,
          sunsetFromViewpoints: opts.sunsetFromViewpoints,
        },
        rows: report,
      },
      null,
      2,
    ),
  )
  console.log(`\nReport written to ${REPORT_PATH}`)
  if (hadErrors) {
    console.error('Finished WITH query errors (partial success) — exit code 1.')
    process.exitCode = 1
  } else {
    console.log('Finished successfully.')
  }
}

main().catch((err) => {
  console.error(`import-osm failed: ${(err as Error).message}`)
  process.exitCode = 1
})
