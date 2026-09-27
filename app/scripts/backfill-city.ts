// Backfill city/country/country_code for places whose `city` is empty
// (contract amendment A9, UX_REVIEW F2). A place inherits a city's fields
// when its lat/lng falls inside that city's import bbox. No geocoder calls —
// the 12 import bboxes are the only source of truth.
//
// Run:  node scripts/backfill-city.ts
// (package.json is orchestrator-owned, so there is intentionally no npm alias;
//  mirrors how `node scripts/import-osm.ts` is invoked.)
//
// Idempotent: only rows with city = '' are touched, so re-runs are no-ops.
import { getDb } from '../server/db.ts'

// ── City bboxes ──────────────────────────────────────────────────────────────
// KEEP IN SYNC with the CITIES constant in scripts/import-osm.ts (same order,
// same [S, W, N, E] bbox order). It is duplicated rather than imported because
// import-osm.ts runs its pipeline at module load (top-level main() call).
interface CityDef {
  slug: string
  city: string
  country: string
  countryCode: string
  /** [S, W, N, E] */
  bbox: [number, number, number, number]
}

const CITIES: CityDef[] = [
  { slug: 'istanbul', city: 'Istanbul', country: 'Türkiye', countryCode: 'TR', bbox: [40.82, 28.55, 41.3, 29.45] },
  { slug: 'berlin', city: 'Berlin', country: 'Germany', countryCode: 'DE', bbox: [52.34, 13.1, 52.67, 13.76] },
  { slug: 'barcelona', city: 'Barcelona', country: 'Spain', countryCode: 'ES', bbox: [41.32, 2.06, 41.47, 2.23] },
  { slug: 'munich', city: 'Munich', country: 'Germany', countryCode: 'DE', bbox: [48.06, 11.36, 48.25, 11.72] },
  { slug: 'london', city: 'London', country: 'United Kingdom', countryCode: 'GB', bbox: [51.29, -0.51, 51.69, 0.33] },
  { slug: 'amsterdam', city: 'Amsterdam', country: 'Netherlands', countryCode: 'NL', bbox: [52.29, 4.74, 52.43, 5.07] },
  { slug: 'new-york', city: 'New York', country: 'United States', countryCode: 'US', bbox: [40.5, -74.26, 40.92, -73.69] },
  { slug: 'san-francisco', city: 'San Francisco', country: 'United States', countryCode: 'US', bbox: [37.71, -122.51, 37.83, -122.36] },
  { slug: 'los-angeles', city: 'Los Angeles', country: 'United States', countryCode: 'US', bbox: [33.7, -118.67, 34.34, -118.16] },
  { slug: 'sydney', city: 'Sydney', country: 'Australia', countryCode: 'AU', bbox: [-34.12, 151.0, -33.7, 151.34] },
  { slug: 'tokyo', city: 'Tokyo', country: 'Japan', countryCode: 'JP', bbox: [35.53, 139.56, 35.82, 139.92] },
  { slug: 'sao-paulo', city: 'São Paulo', country: 'Brazil', countryCode: 'BR', bbox: [-23.88, -46.82, -23.36, -46.37] },
]

function cityFor(lat: number, lng: number): CityDef | null {
  for (const c of CITIES) {
    const [s, w, n, e] = c.bbox
    if (lat >= s && lat <= n && lng >= w && lng <= e) return c
  }
  return null
}

const db = getDb()
const empties = db
  .prepare(`SELECT id, lat, lng FROM places WHERE city = ''`)
  .all() as Array<{ id: number; lat: number; lng: number }>

const counts = new Map<string, number>()
let outsideAll = 0

const update = db.prepare(
  `UPDATE places SET city = ?, country = ?, country_code = ?, updated_at = datetime('now') WHERE id = ? AND city = ''`,
)

db.exec('BEGIN')
try {
  for (const row of empties) {
    const city = cityFor(row.lat, row.lng)
    if (!city) {
      outsideAll++
      continue
    }
    update.run(city.city, city.country, city.countryCode, row.id)
    counts.set(city.slug, (counts.get(city.slug) ?? 0) + 1)
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

const remaining = (db.prepare(`SELECT COUNT(*) AS c FROM places WHERE city = ''`).get() as { c: number }).c

console.log(`backfill-city: scanned ${empties.length} place(s) with empty city`)
for (const c of CITIES) {
  const n = counts.get(c.slug) ?? 0
  if (n > 0) console.log(`  ${c.slug.padEnd(14)} backfilled=${n}`)
}
if (counts.size === 0) console.log('  (nothing to backfill — all empty-city rows already resolved)')
if (outsideAll > 0) console.log(`  outside all 12 bboxes: ${outsideAll} (left empty)`)
console.log(`remaining empty-city rows: ${remaining}`)
