// Shared place query/assembly helpers used by several route modules
// (places, search, me, community, admin). All SQL is prepared with bound
// parameters — user input is never interpolated into statement text.
import { getDb } from './db.ts'
import { httpError } from './http.ts'
import type { SessionUser } from './http.ts'

// ── Types mirroring src/lib/api-types.ts (frozen contract) ──────────────────

export interface CategoryRef {
  slug: string
  name: string
  icon: string
  color: string
}

export interface CategoryRow {
  id: number
  slug: string
  name: string
  icon: string
  color: string
  grp: string
  sort: number
}

export interface AttrDefRow {
  id: number
  category_id: number
  key: string
  label: string
  type: 'bool' | 'enum' | 'number' | 'text'
  options: string | null
  filterable: number
  sort: number
}

export interface SummaryRow {
  id: number
  slug: string
  name: string
  lat: number
  lng: number
  confirm_count: number
  last_verified_at: string | null
  photo_url: string | null
  city: string
  country_code: string
}

export interface PlaceRow extends SummaryRow {
  description: string
  address: string
  city: string
  region: string
  country: string
  country_code: string
  attrs: string
  status: string
  source: string
  source_ref: string | null
  created_by: number | null
  created_at: string
  updated_at: string
  issue_count: number
}

export interface PlaceSummary {
  id: number
  slug: string
  name: string
  lat: number
  lng: number
  categories: CategoryRef[]
  photo_url: string | null
  confirm_count: number
  last_verified_at: string | null
  /** Empty string when unset (contract amendment A9, UX_REVIEW F2). */
  city: string
  country_code: string
  distance_km?: number
}

/** Columns every PlaceSummary query must select (photo_url via subquery). */
export const SUMMARY_SELECT = `
  SELECT p.id, p.slug, p.name, p.lat, p.lng, p.confirm_count, p.last_verified_at,
         p.city, p.country_code,
         (SELECT ph.url FROM photos ph WHERE ph.place_id = p.id ORDER BY ph.id LIMIT 1) AS photo_url
  FROM places p`

/** Attach categories[] to summary rows with one batched IN (...) query. */
export function hydrateSummaries(rows: SummaryRow[]): PlaceSummary[] {
  if (rows.length === 0) return []
  const db = getDb()
  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')
  const catRows = db
    .prepare(
      `SELECT pc.place_id, c.slug, c.name, c.icon, c.color
       FROM place_categories pc JOIN categories c ON c.id = pc.category_id
       WHERE pc.place_id IN (${placeholders})
       ORDER BY c.grp, c.sort, c.id`,
    )
    .all(...ids) as Array<{ place_id: number; slug: string; name: string; icon: string; color: string }>
  const byPlace = new Map<number, CategoryRef[]>()
  for (const c of catRows) {
    const list = byPlace.get(c.place_id) ?? []
    list.push({ slug: c.slug, name: c.name, icon: c.icon, color: c.color })
    byPlace.set(c.place_id, list)
  }
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    categories: byPlace.get(r.id) ?? [],
    photo_url: r.photo_url ?? null,
    confirm_count: r.confirm_count,
    last_verified_at: r.last_verified_at ?? null,
    city: r.city ?? '',
    country_code: r.country_code ?? '',
  }))
}

// ── Category / attribute definition lookups ──────────────────────────────────

export function getCategoryBySlug(slug: string): CategoryRow | undefined {
  return getDb().prepare('SELECT * FROM categories WHERE slug = ?').get(slug) as
    | CategoryRow
    | undefined
}

export function getAttrDefs(categoryId: number): AttrDefRow[] {
  return getDb()
    .prepare('SELECT * FROM category_attributes WHERE category_id = ? ORDER BY sort, id')
    .all(categoryId) as AttrDefRow[]
}

/**
 * Validate a `places.attrs` update object (CONTRACTS §6): keys must be
 * `<category_slug>.<attr_key>`, the category must be one of the place's own
 * categories, the attribute must exist on that category, and the value must
 * match the attribute type. Returns the cleaned attrs object (valid keys only).
 */
export function validateAttrs(
  raw: unknown,
  categorySlugs: string[],
): Record<string, boolean | number | string> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'attrs must be an object')
  const db = getDb()
  const out: Record<string, boolean | number | string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const dot = key.indexOf('.')
    if (dot <= 0) throw httpError(400, `attrs key "${key}" must be namespaced as <category>.<key>`)
    const catSlug = key.slice(0, dot)
    const attrKey = key.slice(dot + 1)
    if (!categorySlugs.includes(catSlug)) {
      throw httpError(400, `attrs key "${key}": category "${catSlug}" is not one of this place's categories`)
    }
    const def = db
      .prepare(
        `SELECT ca.* FROM category_attributes ca
         JOIN categories c ON c.id = ca.category_id
         WHERE c.slug = ? AND ca.key = ?`,
      )
      .get(catSlug, attrKey) as AttrDefRow | undefined
    if (!def) throw httpError(400, `unknown attribute "${key}" for category "${catSlug}"`)
    out[key] = validateAttrValue(key, value, def)
  }
  return out
}

function validateAttrValue(
  key: string,
  value: unknown,
  def: AttrDefRow,
): boolean | number | string {
  switch (def.type) {
    case 'bool':
      if (typeof value !== 'boolean') throw httpError(400, `attribute "${key}" must be true/false`)
      return value
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw httpError(400, `attribute "${key}" must be a number`)
      }
      return value
    case 'enum': {
      const options = def.options ? (JSON.parse(def.options) as string[]) : []
      if (typeof value !== 'string' || !options.includes(value)) {
        throw httpError(400, `attribute "${key}" must be one of: ${options.join(', ')}`)
      }
      return value
    }
    case 'text':
      if (typeof value !== 'string' || value.length > 200) {
        throw httpError(400, `attribute "${key}" must be a string of at most 200 chars`)
      }
      return value
  }
}

// ── Place detail assembly (DATABASE.md §5.6) ─────────────────────────────────

/** Look up a place by slug; fall back to slug_redirects (old → canonical). */
export function findPlaceBySlug(slug: string): { row: PlaceRow; canonicalSlug: string | null } | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT * FROM places WHERE slug = ? AND status <> 'removed'`)
    .get(slug) as PlaceRow | undefined
  if (row) return { row, canonicalSlug: null }
  const redirect = db
    .prepare(`SELECT new_slug FROM slug_redirects WHERE old_slug = ? AND kind = 'place'`)
    .get(slug) as { new_slug: string } | undefined
  if (!redirect) return null
  const canonical = db
    .prepare(`SELECT * FROM places WHERE slug = ? AND status <> 'removed'`)
    .get(redirect.new_slug) as PlaceRow | undefined
  return canonical ? { row: canonical, canonicalSlug: redirect.new_slug } : null
}

export function getPlaceById(id: number, includeRemoved = false): PlaceRow | undefined {
  const sql = includeRemoved
    ? 'SELECT * FROM places WHERE id = ?'
    : `SELECT * FROM places WHERE id = ? AND status <> 'removed'`
  return getDb().prepare(sql).get(id) as PlaceRow | undefined
}

/** Assemble the full PlaceDetail payload for a place row. */
export function assemblePlaceDetail(row: PlaceRow, user: SessionUser | null): Record<string, unknown> {
  const db = getDb()
  const categories = db
    .prepare(
      `SELECT c.* FROM categories c
       JOIN place_categories pc ON pc.category_id = c.id
       WHERE pc.place_id = ? ORDER BY c.grp, c.sort, c.id`,
    )
    .all(row.id) as CategoryRow[]

  // Resolve attrs JSON values against relational attribute definitions.
  const attrsJson = JSON.parse(row.attrs || '{}') as Record<string, unknown>
  const attrsResolved: Array<Record<string, unknown>> = []
  for (const cat of categories) {
    for (const def of getAttrDefs(cat.id)) {
      const fullKey = `${cat.slug}.${def.key}`
      if (Object.prototype.hasOwnProperty.call(attrsJson, fullKey)) {
        attrsResolved.push({
          category_slug: cat.slug,
          key: def.key,
          label: def.label,
          type: def.type,
          value: (attrsJson[fullKey] ?? null) as boolean | number | string | null,
        })
      }
    }
  }

  const photos = db
    .prepare('SELECT url, width, height FROM photos WHERE place_id = ? ORDER BY id')
    .all(row.id) as Array<{ url: string; width: number | null; height: number | null }>

  const comments = db
    .prepare(
      `SELECT u.username, c.body, c.created_at
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.place_id = ? AND c.status = 'published'
       ORDER BY c.id DESC`,
    )
    .all(row.id) as Array<{ username: string; body: string; created_at: string }>

  const creator = row.created_by
    ? (db.prepare('SELECT username FROM users WHERE id = ?').get(row.created_by) as
        | { username: string }
        | undefined)
    : undefined

  const savedByMe = user
    ? Boolean(db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND place_id = ?').get(user.id, row.id))
    : false
  const canEdit = Boolean(user && (user.role === 'admin' || (row.created_by !== null && user.id === row.created_by)))

  // rows from `SELECT * FROM places` lack the photo_url subquery — resolve it
  // explicitly so PlaceDetail.photo_url matches PlaceSummary everywhere else.
  const firstPhoto = db
    .prepare('SELECT url FROM photos WHERE place_id = ? ORDER BY id LIMIT 1')
    .get(row.id) as { url: string } | undefined

  const summary = hydrateSummaries([row])[0]
  summary.photo_url = firstPhoto?.url ?? null
  return {
    ...summary,
    description: row.description,
    address: row.address,
    city: row.city,
    region: row.region,
    country: row.country,
    country_code: row.country_code,
    attrs_resolved: attrsResolved,
    photos,
    comments,
    created_by_username: creator?.username ?? null,
    created_at: row.created_at,
    issue_count: row.issue_count,
    source: row.source,
    saved_by_me: savedByMe,
    can_edit: canEdit,
  }
}

/** Resolve category slugs → rows, throwing 400 on any unknown slug. */
export function resolveCategories(slugs: string[]): CategoryRow[] {
  const rows: CategoryRow[] = []
  for (const slug of slugs) {
    const row = getCategoryBySlug(slug)
    if (!row) throw httpError(400, `unknown category "${slug}"`)
    rows.push(row)
  }
  return rows
}

/** Replace a place's category links inside the current transaction. */
export function linkCategories(placeId: number, categoryRows: CategoryRow[]): void {
  const db = getDb()
  const insert = db.prepare('INSERT OR IGNORE INTO place_categories (place_id, category_id) VALUES (?, ?)')
  for (const cat of categoryRows) insert.run(placeId, cat.id)
}
