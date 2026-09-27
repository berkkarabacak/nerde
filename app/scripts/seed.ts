// Nerde seed script (`npm run seed` → `node scripts/seed.ts`). IDEMPOTENT:
// safe to run repeatedly; every entity is keyed and only real changes are
// written (the summary reports inserted/updated/unchanged per entity type).
//
// Seeds:
//   1. The 18 categories + attribute definitions — EXACTLY CONTRACTS.md §4.
//   2. The admin user from NERDE_ADMIN_EMAIL / NERDE_ADMIN_PASSWORD (only when
//      no admin exists).
//   3. ~12 curated showcase places for the categories OSM cannot cover
//      (DATA_SOURCES.md §4): 4 real, source-cited arm-wrestling venues +
//      8 clearly-labelled "Community demo" entries across 5 cities.
import { getDb } from '../server/db.ts'
import { hashPassword } from '../server/auth.ts'
import { slugify } from '../server/validate.ts'
import { createHash } from 'node:crypto'

// ── 1. Category definitions (CONTRACTS §4 — do not deviate) ──────────────────

type AttrType = 'bool' | 'enum' | 'number' | 'text'

interface AttrSeed {
  key: string
  type: AttrType
  filterable?: boolean
  options?: string[]
  label?: string
}

interface CatSeed {
  slug: string
  name: string
  icon: string
  grp: 'fitness' | 'outdoor'
  color: string
  attrs: AttrSeed[]
}

/** bool+filterable shorthand — most contract attributes are (b,f). */
const bf = (key: string, label?: string): AttrSeed => ({ key, type: 'bool', filterable: true, label })
const b = (key: string, label?: string): AttrSeed => ({ key, type: 'bool', label })
const num = (key: string, label?: string): AttrSeed => ({ key, type: 'number', label })
const txt = (key: string, label?: string): AttrSeed => ({ key, type: 'text', label })
const en = (key: string, options: string[], filterable = false, label?: string): AttrSeed => ({
  key,
  type: 'enum',
  options,
  filterable,
  label,
})
const IN_OUT = ['outdoor', 'indoor']

const FITNESS_COLOR = '#2563eb'
const OUTDOOR_COLOR = '#059669'

const CATEGORIES: CatSeed[] = [
  // ── Group: fitness ──
  {
    slug: 'calisthenics', name: 'Calisthenics Parks', icon: '💪', grp: 'fitness', color: FITNESS_COLOR,
    attrs: [
      bf('pull_up_bars'), bf('parallel_bars'), bf('monkey_bars'), bf('rings'), bf('dip_bars'),
      bf('lighting'), bf('free'), bf('access_24_7'),
      en('indoor_outdoor', IN_OUT),
      en('ground_surface', ['rubber', 'concrete', 'grass', 'sand', 'mixed']),
    ],
  },
  {
    slug: 'arm-wrestling', name: 'Arm Wrestling', icon: '🦾', grp: 'fitness', color: FITNESS_COLOR,
    attrs: [
      bf('dedicated_club'), bf('armwrestling_table'), bf('regular_training'), b('competition_team'),
      bf('membership_required'), bf('drop_ins'), txt('schedule'),
    ],
  },
  {
    slug: 'outdoor-gyms', name: 'Outdoor Gyms', icon: '🏋️', grp: 'fitness', color: FITNESS_COLOR,
    attrs: [bf('free'), bf('lighting'), bf('access_24_7'), b('shaded'), txt('equipment')],
  },
  {
    slug: 'powerlifting', name: 'Powerlifting Gyms', icon: '🏋️‍♂️', grp: 'fitness', color: FITNESS_COLOR,
    attrs: [
      b('competition_plates'), bf('deadlift_platform'), num('squat_racks'),
      bf('membership_required'), bf('drop_ins'), num('day_pass_price'),
    ],
  },
  {
    slug: 'climbing', name: 'Climbing / Bouldering', icon: '🧗', grp: 'fitness', color: FITNESS_COLOR,
    attrs: [
      en('indoor_outdoor', IN_OUT), bf('bouldering'), b('rope_climbing'), bf('free'),
      b('crash_pads_needed'), en('rock_type', ['granite', 'limestone', 'sandstone', 'other']),
    ],
  },
  {
    slug: 'skateparks', name: 'Skateparks', icon: '🛹', grp: 'fitness', color: FITNESS_COLOR,
    attrs: [
      en('indoor_outdoor', IN_OUT), bf('free'), bf('lighting'), b('bowl'), b('street_section'),
      en('surface', ['concrete', 'wood', 'metal']),
    ],
  },
  {
    slug: 'parkour', name: 'Parkour Spots', icon: '🤸', grp: 'fitness', color: FITNESS_COLOR,
    attrs: [bf('free'), b('lighting'), b('access_24_7'), en('indoor_outdoor', IN_OUT)],
  },
  {
    slug: 'basketball', name: 'Basketball Courts', icon: '🏀', grp: 'fitness', color: FITNESS_COLOR,
    attrs: [
      num('hoops'), bf('free'), bf('lighting'), en('indoor_outdoor', IN_OUT),
      en('surface', ['asphalt', 'concrete', 'synthetic', 'wood']), b('nets'),
    ],
  },
  {
    slug: 'table-tennis', name: 'Public Table Tennis', icon: '🏓', grp: 'fitness', color: FITNESS_COLOR,
    attrs: [bf('free'), en('indoor_outdoor', IN_OUT), num('tables'), b('lighting'), bf('bring_own_paddles')],
  },
  // ── Group: outdoor ──
  {
    slug: 'vanlife', name: 'Vanlife Spots', icon: '🚐', grp: 'outdoor', color: OUTDOOR_COLOR,
    attrs: [
      bf('overnight_allowed'), bf('free'), bf('toilet'), b('shower'), bf('drinking_water'),
      b('electricity'), b('waste_disposal'), bf('quiet'), txt('height_restriction'),
      num('max_vehicle_length'), en('mobile_signal', ['none', 'weak', 'good']),
    ],
  },
  {
    slug: 'overnight-parking', name: 'Overnight Parking', icon: '🅿️', grp: 'outdoor', color: OUTDOOR_COLOR,
    attrs: [bf('overnight_allowed'), bf('free'), b('toilet'), bf('quiet'), b('security'), txt('height_restriction')],
  },
  {
    slug: 'public-showers', name: 'Public Showers', icon: '🚿', grp: 'outdoor', color: OUTDOOR_COLOR,
    attrs: [bf('free'), b('hot_water'), bf('access_24_7'), en('indoor_outdoor', IN_OUT), num('price')],
  },
  {
    slug: 'drinking-water', name: 'Drinking Water', icon: '⛲', grp: 'outdoor', color: OUTDOOR_COLOR,
    attrs: [bf('free'), b('access_24_7'), b('seasonal'), b('potable_confirmed')],
  },
  {
    slug: 'bbq-picnic', name: 'BBQ & Picnic Areas', icon: '🍖', grp: 'outdoor', color: OUTDOOR_COLOR,
    attrs: [bf('free'), bf('bbq_grill'), b('fire_allowed'), b('tables'), b('toilets_nearby'), b('drinking_water')],
  },
  {
    slug: 'swimming-spots', name: 'Swimming Spots', icon: '🏊', grp: 'outdoor', color: OUTDOOR_COLOR,
    attrs: [
      bf('free'), en('water_type', ['sea', 'lake', 'river', 'pool'], true), b('cold_water'),
      en('entry_type', ['beach', 'rocks', 'dock']), b('lifeguard'),
    ],
  },
  {
    slug: 'viewpoints', name: 'Viewpoints', icon: '🌄', grp: 'outdoor', color: OUTDOOR_COLOR,
    attrs: [b('free'), b('access_24_7'), bf('sunset_facing'), b('sunrise_facing'), b('seating'), bf('hike_required')],
  },
  {
    slug: 'sunset-spots', name: 'Sunset Spots', icon: '🌇', grp: 'outdoor', color: OUTDOOR_COLOR,
    attrs: [b('free'), b('west_facing'), b('seating'), en('crowded', ['quiet', 'moderate', 'busy'], true)],
  },
  {
    slug: 'photo-spots', name: 'Photography Spots', icon: '📷', grp: 'outdoor', color: OUTDOOR_COLOR,
    attrs: [
      b('free'), en('best_time', ['sunrise', 'golden_hour', 'blue_hour', 'night', 'anytime'], true),
      en('subject', ['cityscape', 'nature', 'architecture', 'wildlife', 'street'], true), bf('drone_friendly'),
    ],
  },
]

/** Human labels: contract examples + generic humanization of the snake_case key. */
const SPECIAL_LABELS: Record<string, string> = {
  pull_up_bars: 'Pull-up bars',
  access_24_7: '24/7 access',
  bbq_grill: 'BBQ grill',
  indoor_outdoor: 'Indoor/outdoor',
  drop_ins: 'Drop-ins',
}

function humanize(key: string): string {
  if (SPECIAL_LABELS[key]) return SPECIAL_LABELS[key]
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// ── 3. Curated places (DATA_SOURCES.md §4) ───────────────────────────────────

interface PlaceSeed {
  name: string
  description: string
  lat: number
  lng: number
  address?: string
  city: string
  region: string
  country: string
  countryCode: string
  categories: string[]
  attrs: Record<string, boolean | number | string>
}

// Deterministic slug suffix so re-seeds regenerate the same slug (idempotent).
function seedSuffix(name: string): string {
  const h = createHash('sha1').update(`nerde-seed:${name}`).digest()
  return (h.readUInt32BE(0) % 36 ** 4).toString(36).padStart(4, '0')
}

const DEMO_NOTE =
  'Demo entry seeded to preview this category — it does not describe a verified venue and will be replaced by real community data.'

// Real venues: ONLY those explicitly verified in DATA_SOURCES.md §4 (with URLs).
// Coordinates geocoded at seed-authoring time via the Photon API
// (photon.komoot.io); each description states the coordinate precision.
const CURATED_PLACES: PlaceSeed[] = [
  {
    name: 'Armagh Geddon Arm Wrestling Club',
    description:
      'Arm wrestling club with weekly training on Tuesdays at 18:30 at The Bodyworks Gym, Armagh. Source: northernirelandarmwrestling.co.uk. Location shown at city level — exact venue coordinates pending community confirmation.',
    lat: 54.3482, lng: -6.654,
    address: 'The Bodyworks Gym, Armagh',
    city: 'Armagh', region: 'Northern Ireland', country: 'United Kingdom', countryCode: 'GB',
    categories: ['arm-wrestling'],
    attrs: {
      'arm-wrestling.dedicated_club': true,
      'arm-wrestling.regular_training': true,
      'arm-wrestling.schedule': 'Tuesdays 18:30',
    },
  },
  {
    name: 'Gegns Gym Armwrestling',
    description:
      'Gym in San Diego offering armwrestling classes, workshops and competitions. Source: gegnsgym.com/armwrestling-events. Approximate city-level location — exact address to be confirmed by the community.',
    lat: 32.7157, lng: -117.1611,
    city: 'San Diego', region: 'California', country: 'United States', countryCode: 'US',
    categories: ['arm-wrestling'],
    attrs: {
      'arm-wrestling.regular_training': true,
      'arm-wrestling.schedule': 'Classes, workshops & competitions — see club website',
    },
  },
  {
    name: 'Kernow Armwrestlers',
    description:
      'Cornwall arm wrestling club training at Kernow Gym, Unicorn House, Wilson Way, Redruth. Listed in the PAA UK & Ireland club directory (paa-armwrestling.com/clubs). Street-level location (Wilson Way).',
    lat: 50.226, lng: -5.257,
    address: 'Kernow Gym, Unicorn House, Wilson Way, Redruth TR15 3RT',
    city: 'Redruth', region: 'Cornwall', country: 'United Kingdom', countryCode: 'GB',
    categories: ['arm-wrestling'],
    attrs: { 'arm-wrestling.dedicated_club': true, 'arm-wrestling.regular_training': true },
  },
  {
    name: 'Liverpool Armwrestling',
    description:
      'Arm wrestling club based in Upton, Wirral. Listed in the PAA UK & Ireland club directory (paa-armwrestling.com/clubs). Locality-level location — exact gym address pending community confirmation.',
    lat: 53.3864, lng: -3.0841,
    city: 'Upton', region: 'Merseyside', country: 'United Kingdom', countryCode: 'GB',
    categories: ['arm-wrestling'],
    attrs: { 'arm-wrestling.dedicated_club': true },
  },
  // Community demos — clearly labelled, source='curated', across 5 cities.
  {
    name: 'Community demo sunset point (Istanbul)',
    description: DEMO_NOTE, lat: 41.038, lng: 28.993,
    city: 'Istanbul', region: 'Istanbul', country: 'Türkiye', countryCode: 'TR',
    categories: ['sunset-spots'],
    attrs: { 'sunset-spots.crowded': 'moderate', 'sunset-spots.seating': true },
  },
  {
    name: 'Community demo photo spot (Istanbul)',
    description: DEMO_NOTE, lat: 41.0256, lng: 28.9742,
    city: 'Istanbul', region: 'Istanbul', country: 'Türkiye', countryCode: 'TR',
    categories: ['photo-spots'],
    attrs: { 'photo-spots.subject': 'cityscape', 'photo-spots.best_time': 'golden_hour' },
  },
  {
    name: 'Community demo parkour spot (Berlin)',
    description: DEMO_NOTE, lat: 52.5145, lng: 13.3501,
    city: 'Berlin', region: 'Berlin', country: 'Germany', countryCode: 'DE',
    categories: ['parkour'],
    attrs: { 'parkour.free': true, 'parkour.indoor_outdoor': 'outdoor' },
  },
  {
    name: 'Community demo powerlifting gym (Berlin)',
    description: DEMO_NOTE, lat: 52.4986, lng: 13.4189,
    city: 'Berlin', region: 'Berlin', country: 'Germany', countryCode: 'DE',
    categories: ['powerlifting'],
    attrs: { 'powerlifting.drop_ins': true, 'powerlifting.day_pass_price': 15 },
  },
  {
    name: 'Community demo vanlife spot (London)',
    description: DEMO_NOTE, lat: 51.4745, lng: -0.2217,
    city: 'London', region: 'England', country: 'United Kingdom', countryCode: 'GB',
    categories: ['vanlife'],
    attrs: { 'vanlife.quiet': true },
  },
  {
    name: 'Community demo overnight parking (New York)',
    description: DEMO_NOTE, lat: 40.6782, lng: -74.0162,
    city: 'New York', region: 'New York', country: 'United States', countryCode: 'US',
    categories: ['overnight-parking'],
    attrs: { 'overnight-parking.overnight_allowed': true },
  },
  {
    name: 'Community demo sunset view (New York)',
    description: DEMO_NOTE, lat: 40.7308, lng: -74.0126,
    city: 'New York', region: 'New York', country: 'United States', countryCode: 'US',
    categories: ['sunset-spots'],
    attrs: { 'sunset-spots.crowded': 'busy', 'sunset-spots.free': true },
  },
  {
    name: 'Community demo public shower (San Francisco)',
    description: DEMO_NOTE, lat: 37.7694, lng: -122.4862,
    city: 'San Francisco', region: 'California', country: 'United States', countryCode: 'US',
    categories: ['public-showers'],
    attrs: { 'public-showers.indoor_outdoor': 'outdoor' },
  },
]

// ── Seed runner ──────────────────────────────────────────────────────────────

const counts = {
  categories: { inserted: 0, updated: 0, unchanged: 0 },
  attributes: { inserted: 0, updated: 0, unchanged: 0 },
  admin: { inserted: 0, unchanged: 0 },
  places: { inserted: 0, unchanged: 0 },
}

function seedCategories(): void {
  const db = getDb()
  const groupSort = new Map<string, number>()
  for (const cat of CATEGORIES) {
    const sort = (groupSort.get(cat.grp) ?? 0) + 1
    groupSort.set(cat.grp, sort)
    const existing = db.prepare('SELECT * FROM categories WHERE slug = ?').get(cat.slug) as
      | { id: number; name: string; icon: string; color: string; grp: string; sort: number }
      | undefined
    let categoryId: number
    if (!existing) {
      const inserted = db
        .prepare('INSERT INTO categories (slug, name, icon, color, grp, sort) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
        .get(cat.slug, cat.name, cat.icon, cat.color, cat.grp, sort) as { id: number }
      categoryId = inserted.id
      counts.categories.inserted++
    } else {
      categoryId = existing.id
      if (
        existing.name !== cat.name || existing.icon !== cat.icon ||
        existing.color !== cat.color || existing.grp !== cat.grp || existing.sort !== sort
      ) {
        db.prepare('UPDATE categories SET name = ?, icon = ?, color = ?, grp = ?, sort = ? WHERE id = ?')
          .run(cat.name, cat.icon, cat.color, cat.grp, sort, categoryId)
        counts.categories.updated++
      } else {
        counts.categories.unchanged++
      }
    }
    seedAttributes(categoryId, cat.attrs)
  }
}

function seedAttributes(categoryId: number, attrs: AttrSeed[]): void {
  const db = getDb()
  const findStmt = db.prepare(
    'SELECT * FROM category_attributes WHERE category_id = ? AND key = ?',
  )
  attrs.forEach((attr, index) => {
    const label = attr.label ?? humanize(attr.key)
    const options = attr.options ? JSON.stringify(attr.options) : null
    const filterable = attr.filterable ? 1 : 0
    const sort = index + 1
    const existing = findStmt.get(categoryId, attr.key) as
      | { id: number; label: string; type: string; options: string | null; filterable: number; sort: number }
      | undefined
    if (!existing) {
      db.prepare(
        `INSERT INTO category_attributes (category_id, key, label, type, options, filterable, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(categoryId, attr.key, label, attr.type, options, filterable, sort)
      counts.attributes.inserted++
    } else if (
      existing.label !== label || existing.type !== attr.type ||
      existing.options !== options || existing.filterable !== filterable || existing.sort !== sort
    ) {
      db.prepare(
        'UPDATE category_attributes SET label = ?, type = ?, options = ?, filterable = ?, sort = ? WHERE id = ?',
      ).run(label, attr.type, options, filterable, sort, existing.id)
      counts.attributes.updated++
    } else {
      counts.attributes.unchanged++
    }
  })
}

function seedAdmin(): void {
  const db = getDb()
  const hasAdmin = db.prepare(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`).get()
  if (hasAdmin) {
    counts.admin.unchanged++
    return
  }
  const email = (process.env.NERDE_ADMIN_EMAIL ?? 'admin@nerde.local').toLowerCase()
  const password = process.env.NERDE_ADMIN_PASSWORD ?? 'nerde-admin-2026'
  const username = 'admin'
  // Extremely unlikely on a fresh DB, but never collide with a taken login.
  if (db.prepare('SELECT 1 FROM users WHERE email = ? OR username = ?').get(email, username)) {
    console.log(`! admin skipped: ${email} or "${username}" already exists as a non-admin user`)
    counts.admin.unchanged++
    return
  }
  db.prepare(`INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, 'admin')`)
    .run(email, username, hashPassword(password))
  console.log(`+ admin user created: ${email} (password from NERDE_ADMIN_PASSWORD)`)
  counts.admin.inserted++
}

function seedPlaces(): void {
  const db = getDb()
  const catIds = new Map<string, number>()
  for (const row of db.prepare('SELECT id, slug FROM categories').all() as Array<{ id: number; slug: string }>) {
    catIds.set(row.slug, row.id)
  }
  const linkStmt = db.prepare('INSERT OR IGNORE INTO place_categories (place_id, category_id) VALUES (?, ?)')
  for (const place of CURATED_PLACES) {
    const slug = `${slugify(place.name)}-${seedSuffix(place.name)}`
    if (db.prepare('SELECT 1 FROM places WHERE slug = ?').get(slug)) {
      counts.places.unchanged++
      continue
    }
    const inserted = db
      .prepare(
        `INSERT INTO places (slug, name, description, lat, lng, address, city, region,
                             country, country_code, attrs, status, source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 'curated', NULL)
         RETURNING id`,
      )
      .get(
        slug, place.name, place.description, place.lat, place.lng,
        place.address ?? '', place.city, place.region, place.country, place.countryCode,
        JSON.stringify(place.attrs),
      ) as { id: number }
    for (const catSlug of place.categories) {
      const catId = catIds.get(catSlug)
      if (catId) linkStmt.run(inserted.id, catId)
    }
    counts.places.inserted++
  }
}

function main(): void {
  console.log('Nerde seed —', new Date().toISOString())
  seedCategories()
  seedAdmin()
  seedPlaces()
  const line = (label: string, c: { inserted: number; updated?: number; unchanged: number }): string =>
    `  ${label.padEnd(11)} inserted=${c.inserted} updated=${c.updated ?? 0} unchanged=${c.unchanged}`
  console.log('Summary:')
  console.log(line('categories', counts.categories))
  console.log(line('attributes', counts.attributes))
  console.log(line('admin', counts.admin))
  console.log(line('places', counts.places))
  const changed =
    counts.categories.inserted + counts.categories.updated +
    counts.attributes.inserted + counts.attributes.updated +
    counts.admin.inserted + counts.places.inserted
  console.log(changed === 0 ? 'No changes — database already up to date.' : `Done — ${changed} change(s) applied.`)
}

main()
