// Place routes: viewport bbox listing, nearest-N, detail by slug, create.
// Query patterns follow DATABASE.md §5.1 (bbox), §5.2 (near), §5.3 (duplicates),
// §5.6 (detail assembly).
import { randomInt } from 'node:crypto'
import { bboxForRadius, getDb, haversineKm, normalizeLng } from '../db.ts'
import { httpError, json } from '../http.ts'
import type { Ctx } from '../http.ts'
import {
  SUMMARY_SELECT,
  assemblePlaceDetail,
  findPlaceBySlug,
  hydrateSummaries,
  linkCategories,
  resolveCategories,
  validateAttrs,
} from '../placeData.ts'
import type { SummaryRow } from '../placeData.ts'
import {
  asNumber,
  clampFloat,
  clampInt,
  escapeLike,
  namesSimilar,
  readJson,
  requireNumber,
  requireString,
  optString,
  slugify,
} from '../validate.ts'

/**
 * Antimeridian-safe longitude predicate (DATABASE.md §5.1): when w > e the
 * viewport wraps the 180° meridian and the band becomes two ranges.
 * Consumes 8 bound params in this exact order: w,e,w,e, w,e,w,e.
 */
const LNG_PREDICATE = `((? <= ? AND p.lng BETWEEN ? AND ?) OR (? > ? AND (p.lng >= ? OR p.lng <= ?)))`

function lngParams(w: number, e: number): number[] {
  return [w, e, w, e, w, e, w, e]
}

// ── GET /api/places?bbox=w,s,e,n[&cat][&attrs][&q][&limit] ───────────────────

export async function listPlaces(ctx: Ctx): Promise<void> {
  const q = ctx.query
  const bboxRaw = q.get('bbox')
  if (!bboxRaw) throw httpError(400, 'bbox is required as "w,s,e,n"')
  const parts = bboxRaw.split(',').map((s) => Number(s.trim()))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw httpError(400, 'invalid bbox — expected "w,s,e,n" numbers')
  }
  const s = Math.max(-90, Math.min(90, parts[1]))
  const n = Math.max(-90, Math.min(90, parts[3]))
  if (s > n) throw httpError(400, 'invalid bbox — south is greater than north')
  const w = normalizeLng(parts[0])
  const e = normalizeLng(parts[2])

  const cat = (q.get('cat') ?? '').trim() || null
  const text = (q.get('q') ?? '').trim().slice(0, 100) || null
  const limit = clampInt(q.get('limit'), 1, 1000, 500)

  // Attribute truthy filters: comma list of `cat.key`, each validated against
  // category_attributes so a typo is a 400, not a silent empty result.
  const attrKeys = (q.get('attrs') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const db = getDb()
  const attrPaths: string[] = []
  for (const key of attrKeys.slice(0, 20)) {
    const dot = key.indexOf('.')
    const def =
      dot > 0
        ? db
            .prepare(
              `SELECT 1 FROM category_attributes ca
               JOIN categories c ON c.id = ca.category_id
               WHERE c.slug = ? AND ca.key = ?`,
            )
            .get(key.slice(0, dot), key.slice(dot + 1))
        : undefined
    if (!def) throw httpError(400, `unknown attribute filter "${key}"`)
    // Quoted-label JSON path because the key contains a dot.
    attrPaths.push(`$."${key}"`)
  }

  const where: string[] = [`p.status = 'published'`, `p.lat BETWEEN ? AND ?`, LNG_PREDICATE]
  const params: Array<string | number> = [s, n, ...lngParams(w, e)]
  if (cat) {
    where.push(
      `p.id IN (SELECT pc.place_id FROM place_categories pc
                JOIN categories c ON c.id = pc.category_id WHERE c.slug = ?)`,
    )
    params.push(cat)
  }
  if (text) {
    where.push(`(p.name LIKE '%' || ? || '%' ESCAPE '\\' OR p.description LIKE '%' || ? || '%' ESCAPE '\\')`)
    const escaped = escapeLike(text)
    params.push(escaped, escaped)
  }
  for (const path of attrPaths) {
    // Truthiness per DATABASE.md §5.1: JSON true→1, false→0, missing/null→NULL,
    // enum/text values pass through; 0 and '' are falsy.
    where.push(`json_extract(p.attrs, ?) IS NOT NULL AND json_extract(p.attrs, ?) NOT IN (0, '')`)
    params.push(path, path)
  }

  // Truncation honesty (contract amendment, CRITICAL_REVIEW I1): report the
  // full bbox count and flag truncation instead of silently returning an
  // import-ordered subset. When the result exceeds the limit, ORDER BY a cheap
  // multiplicative hash of the id selects a deterministic, spatially scattered
  // sample (import order clusters by city; the hash does not). NOTE: the
  // PostGIS migration (DATABASE.md upgrade path) replaces this with real
  // spatial sampling / server-side clustering.
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM places p WHERE ${where.join(' AND ')}`)
    .get(...params) as { c: number }
  const rows = db
    .prepare(
      `${SUMMARY_SELECT} WHERE ${where.join(' AND ')} ORDER BY (p.id * 2654435761) % 100000 LIMIT ?`,
    )
    .all(...params, limit) as SummaryRow[]
  const places = hydrateSummaries(rows)
  json(ctx.res, 200, {
    places,
    total_count: totalRow.c,
    truncated: totalRow.c > places.length,
  })
}

// ── GET /api/places/near?lat=&lng=&radius_km=30[&cat=] ───────────────────────

export async function nearPlaces(ctx: Ctx): Promise<void> {
  const lat = asNumber(ctx.query.get('lat'))
  const lng = asNumber(ctx.query.get('lng'))
  if (lat === null || lat < -90 || lat > 90) throw httpError(400, 'lat must be between -90 and 90')
  if (lng === null || lng < -180 || lng > 180) throw httpError(400, 'lng must be between -180 and 180')
  const radiusKm = clampFloat(ctx.query.get('radius_km'), 0.1, 500, 30)
  const cat = (ctx.query.get('cat') ?? '').trim() || null

  // Over-approximating square prefilter in SQL; exact circle + sort in JS.
  const bb = bboxForRadius(lat, lng, radiusKm)
  const where: string[] = [`p.status = 'published'`, `p.lat BETWEEN ? AND ?`]
  const params: Array<string | number> = [bb.s, bb.n]
  if (!bb.fullLng) {
    where.push(LNG_PREDICATE)
    params.push(...lngParams(bb.w, bb.e))
  }
  if (cat) {
    where.push(
      `p.id IN (SELECT pc.place_id FROM place_categories pc
                JOIN categories c ON c.id = pc.category_id WHERE c.slug = ?)`,
    )
    params.push(cat)
  }
  const rows = getDb()
    .prepare(`${SUMMARY_SELECT} WHERE ${where.join(' AND ')}`)
    .all(...params) as SummaryRow[]

  const withDistance = hydrateSummaries(rows)
    .map((p) => ({ ...p, distance_km: haversineKm(lat, lng, p.lat, p.lng) }))
    .filter((p) => p.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 50)
    .map((p) => ({ ...p, distance_km: Math.round(p.distance_km * 100) / 100 }))
  json(ctx.res, 200, { places: withDistance })
}

// ── GET /api/places/:slug ────────────────────────────────────────────────────

export async function getPlace(ctx: Ctx): Promise<void> {
  const found = findPlaceBySlug(ctx.params.slug)
  if (!found) throw httpError(404, 'place not found')
  const detail = assemblePlaceDetail(found.row, ctx.user)
  // Slug redirect hit → tell the client the canonical slug (200, not 301, so
  // the SPA can update the URL client-side).
  if (found.canonicalSlug) detail.canonical_slug = found.canonicalSlug
  json(ctx.res, 200, { place: detail })
}

// ── POST /api/places (auth optional) ─────────────────────────────────────────

/** Four random base36 chars for slug suffixes. */
function randomSuffix(): string {
  return randomInt(36 ** 4).toString(36).padStart(4, '0')
}

export async function createPlace(ctx: Ctx): Promise<void> {
  const body = (await readJson(ctx.req)) as Record<string, unknown>

  // Honeypot: bots that fill the hidden `website` field get a silent fake-201.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    json(ctx.res, 201, { place: { id: -1, slug: 'submitted' } })
    return
  }

  const name = requireString(body, 'name', 2, 80)
  const description = optString(body, 'description', 2000)
  const lat = requireNumber(body, 'lat', -90, 90)
  const lng = requireNumber(body, 'lng', -180, 180)
  const address = optString(body, 'address', 200)
  const city = optString(body, 'city', 120)
  const region = optString(body, 'region', 120)
  const country = optString(body, 'country', 120)
  const countryCode = optString(body, 'country_code', 2).toUpperCase()

  if (!Array.isArray(body.categories)) throw httpError(400, 'categories must be an array of slugs')
  const catSlugs = [...new Set(body.categories.map((c) => String(c).trim()).filter(Boolean))]
  if (catSlugs.length < 1) throw httpError(400, 'at least one category is required')
  if (catSlugs.length > 5) throw httpError(400, 'at most 5 categories per place')
  const categoryRows = resolveCategories(catSlugs)
  const attrs = validateAttrs(body.attrs, catSlugs)

  // Duplicate scan (DATABASE.md §5.3): ≤100 m AND (shared category OR
  // name-similar). Removed places excluded; pending still blocks dupes.
  const db = getDb()
  const bb = bboxForRadius(lat, lng, 0.1)
  const dupeWhere: string[] = [`p.status <> 'removed'`, `p.lat BETWEEN ? AND ?`]
  const dupeParams: Array<string | number> = [bb.s, bb.n]
  if (!bb.fullLng) {
    dupeWhere.push(LNG_PREDICATE)
    dupeParams.push(...lngParams(bb.w, bb.e))
  }
  const candidates = db
    .prepare(`${SUMMARY_SELECT} WHERE ${dupeWhere.join(' AND ')}`)
    .all(...dupeParams) as SummaryRow[]
  const near = hydrateSummaries(
    candidates.filter((c) => haversineKm(lat, lng, c.lat, c.lng) <= 0.1),
  )
  const duplicates = near.filter(
    (p) =>
      p.categories.some((c) => catSlugs.includes(c.slug)) || namesSimilar(p.name, name),
  )
  if (duplicates.length > 0 && body.force !== true) {
    throw httpError(409, 'possible duplicate place nearby', { duplicates })
  }

  // Slug = slugified name + '-' + 4 random base36 chars, with collision retry.
  const base = slugify(name)
  let slug = ''
  let id = 0
  for (let attempt = 0; attempt < 5; attempt++) {
    slug = `${base}-${randomSuffix()}`
    try {
      db.exec('BEGIN')
      const inserted = db
        .prepare(
          `INSERT INTO places (slug, name, description, lat, lng, address, city, region,
                               country, country_code, attrs, status, source, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 'community', ?)
           RETURNING id`,
        )
        .get(
          slug,
          name,
          description,
          lat,
          lng,
          address,
          city,
          region,
          country,
          countryCode,
          JSON.stringify(attrs),
          ctx.user?.id ?? null,
        ) as { id: number }
      id = inserted.id
      linkCategories(id, categoryRows)
      db.exec('COMMIT')
      break
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // already rolled back
      }
      // UNIQUE(slug) collision → retry with a fresh suffix; anything else → fail.
      if (attempt === 4 || !String((err as Error).message).includes('places.slug')) throw err
    }
  }
  json(ctx.res, 201, { place: { id, slug } })
}
