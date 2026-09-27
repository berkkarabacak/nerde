// Admin routes (CONTRACTS §6 — role='admin' only, else 403).
import { getDb } from '../db.ts'
import { requireAdmin } from '../auth.ts'
import { httpError, json } from '../http.ts'
import type { Ctx, SessionUser } from '../http.ts'
import {
  assemblePlaceDetail,
  getPlaceById,
  linkCategories,
  resolveCategories,
  validateAttrs,
} from '../placeData.ts'
import type { AttrDefRow, CategoryRow } from '../placeData.ts'
import {
  asNumber,
  asTrimmed,
  bool01,
  clampInt,
  isKebabSlug,
  optString,
  readJson,
  requireNumber,
  requireString,
} from '../validate.ts'

// ── Reports ──────────────────────────────────────────────────────────────────

const REPORT_STATUSES = new Set(['open', 'resolved', 'dismissed'])

/** GET /api/admin/reports?status=open — moderation queue. */
export async function adminReports(ctx: Ctx): Promise<void> {
  requireAdmin(ctx)
  const status = (ctx.query.get('status') ?? 'open').trim()
  const db = getDb()
  const base = `SELECT r.id, r.place_id, r.reason, r.note, r.status, r.created_at,
                       p.name AS place_name, p.slug AS place_slug, p.status AS place_status,
                       u.username AS reporter_username
                FROM reports r
                JOIN places p ON p.id = r.place_id
                LEFT JOIN users u ON u.id = r.user_id`
  const rows =
    status === 'all'
      ? db.prepare(`${base} ORDER BY r.id DESC LIMIT 500`).all()
      : db.prepare(`${base} WHERE r.status = ? ORDER BY r.id DESC LIMIT 500`).all(status)
  json(ctx.res, 200, { reports: rows })
}

/** POST /api/admin/reports/:id — {status: open|resolved|dismissed}. */
export async function adminUpdateReport(ctx: Ctx): Promise<void> {
  requireAdmin(ctx)
  const id = asNumber(ctx.params.id)
  if (id === null) throw httpError(400, 'invalid report id')
  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const status = asTrimmed(body.status, 20)
  if (!REPORT_STATUSES.has(status)) throw httpError(400, 'status must be open|resolved|dismissed')
  const changed = getDb().prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, id)
  if (changed.changes === 0) throw httpError(404, 'report not found')
  json(ctx.res, 200, { ok: true })
}

// ── Place moderation + editing ───────────────────────────────────────────────

/** POST /api/admin/places/:id — {action: publish|remove|restore}. */
export async function adminPlaceAction(ctx: Ctx): Promise<void> {
  requireAdmin(ctx)
  const id = asNumber(ctx.params.id)
  if (id === null) throw httpError(400, 'invalid place id')
  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const action = asTrimmed(body.action, 20)
  const next =
    action === 'publish' || action === 'restore'
      ? 'published'
      : action === 'remove'
        ? 'removed'
        : null
  if (!next) throw httpError(400, `action must be 'publish', 'remove' or 'restore'`)
  const changed = getDb()
    .prepare(`UPDATE places SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(next, id)
  if (changed.changes === 0) throw httpError(404, 'place not found')
  json(ctx.res, 200, { ok: true, status: next })
}

/**
 * PUT /api/admin/places/:id — edit fields. Provided fields only; slug never
 * changes (URL permanence, DATABASE.md §8). Returns the updated PlaceDetail.
 */
export async function adminEditPlace(ctx: Ctx): Promise<void> {
  const user = requireAdmin(ctx)
  const id = asNumber(ctx.params.id)
  if (id === null) throw httpError(400, 'invalid place id')
  const db = getDb()
  const place = getPlaceById(id, true)
  if (!place) throw httpError(404, 'place not found')

  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const sets: string[] = []
  const params: Array<string | number | null> = []

  if (body.name !== undefined) {
    sets.push('name = ?')
    params.push(requireString(body, 'name', 2, 80))
  }
  if (body.description !== undefined) {
    sets.push('description = ?')
    params.push(optString(body, 'description', 2000))
  }
  if (body.lat !== undefined) {
    sets.push('lat = ?')
    params.push(requireNumber(body, 'lat', -90, 90))
  }
  if (body.lng !== undefined) {
    sets.push('lng = ?')
    params.push(requireNumber(body, 'lng', -180, 180))
  }
  for (const field of ['address', 'city', 'region', 'country'] as const) {
    if (body[field] !== undefined) {
      sets.push(`${field} = ?`)
      params.push(optString(body, field, field === 'address' ? 200 : 120))
    }
  }
  if (body.country_code !== undefined) {
    sets.push('country_code = ?')
    params.push(optString(body, 'country_code', 2).toUpperCase())
  }
  if (body.status !== undefined) {
    const status = asTrimmed(body.status, 20)
    if (!['published', 'pending', 'removed'].includes(status)) {
      throw httpError(400, 'status must be published|pending|removed')
    }
    sets.push('status = ?')
    params.push(status)
  }

  // Categories (replace) — resolved first so attrs validate against the final set.
  let categoryRows: CategoryRow[] | null = null
  if (body.categories !== undefined) {
    if (!Array.isArray(body.categories)) throw httpError(400, 'categories must be an array of slugs')
    const slugs = [...new Set(body.categories.map((c) => String(c).trim()).filter(Boolean))]
    if (slugs.length < 1) throw httpError(400, 'at least one category is required')
    if (slugs.length > 5) throw httpError(400, 'at most 5 categories per place')
    categoryRows = resolveCategories(slugs)
  }
  const effectiveSlugs = categoryRows
    ? categoryRows.map((c) => c.slug)
    : (db
        .prepare(
          `SELECT c.slug FROM categories c JOIN place_categories pc ON pc.category_id = c.id
           WHERE pc.place_id = ?`,
        )
        .all(id) as Array<{ slug: string }>
      ).map((r) => r.slug)
  if (body.attrs !== undefined) {
    sets.push('attrs = ?')
    params.push(JSON.stringify(validateAttrs(body.attrs, effectiveSlugs)))
  }

  db.exec('BEGIN')
  try {
    if (sets.length > 0) {
      db.prepare(`UPDATE places SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
        ...params,
        id,
      )
    }
    if (categoryRows) {
      db.prepare('DELETE FROM place_categories WHERE place_id = ?').run(id)
      linkCategories(id, categoryRows)
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
  const updated = getPlaceById(id, true)
  json(ctx.res, 200, { place: assemblePlaceDetail(updated!, user) })
}

// ── Category management ──────────────────────────────────────────────────────

interface AttrInput {
  key: string
  label: string
  type: string
  options: string[] | null
  filterable: boolean
  sort: number
}

const ATTR_TYPES = new Set(['bool', 'enum', 'number', 'text'])
const KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/

function parseAttributes(raw: unknown): AttrInput[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw httpError(400, 'attributes must be an array')
  return raw.map((item, i) => {
    const a = item as Record<string, unknown>
    const key = asTrimmed(a.key, 40)
    if (!KEY_RE.test(key)) throw httpError(400, `attributes[${i}].key must be snake_case`)
    const label = asTrimmed(a.label, 60)
    if (!label) throw httpError(400, `attributes[${i}].label is required`)
    const type = asTrimmed(a.type, 10)
    if (!ATTR_TYPES.has(type)) throw httpError(400, `attributes[${i}].type must be bool|enum|number|text`)
    let options: string[] | null = null
    if (type === 'enum') {
      if (!Array.isArray(a.options) || a.options.length === 0) {
        throw httpError(400, `attributes[${i}].options must be a non-empty array for enum`)
      }
      options = a.options.map((o) => {
        const v = String(o).trim()
        if (!v || v.length > 40) throw httpError(400, `attributes[${i}].options values must be 1–40 chars`)
        return v
      })
    }
    const sort = asNumber(a.sort) ?? 0
    return { key, label, type, options, filterable: a.filterable === true, sort: Math.floor(sort) }
  })
}

function insertAttributes(categoryId: number, attributes: AttrInput[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO category_attributes (category_id, key, label, type, options, filterable, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const a of attributes) {
    stmt.run(categoryId, a.key, a.label, a.type, a.options ? JSON.stringify(a.options) : null, bool01(a.filterable), a.sort)
  }
}

function categoryJson(cat: CategoryRow): Record<string, unknown> {
  const attributes = (
    getDb()
      .prepare('SELECT * FROM category_attributes WHERE category_id = ? ORDER BY sort, id')
      .all(cat.id) as AttrDefRow[]
  ).map((a) => ({
    key: a.key,
    label: a.label,
    type: a.type,
    options: a.options ? (JSON.parse(a.options) as string[]) : null,
    filterable: Boolean(a.filterable),
    sort: a.sort,
  }))
  return { ...cat, attributes }
}

/** POST /api/admin/categories — create category + attribute definitions. */
export async function adminCreateCategory(ctx: Ctx): Promise<void> {
  requireAdmin(ctx)
  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const slug = asTrimmed(body.slug, 60)
  if (!isKebabSlug(slug)) throw httpError(400, 'slug must be kebab-case (2–60 chars)')
  const name = requireString(body, 'name', 1, 60)
  const icon = optString(body, 'icon', 16, '📍') || '📍'
  const color = optString(body, 'color', 7, '#2563eb') || '#2563eb'
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw httpError(400, 'color must be a #rrggbb hex value')
  const grp = optString(body, 'grp', 20, 'outdoor') || 'outdoor'
  if (!['fitness', 'outdoor'].includes(grp)) throw httpError(400, 'grp must be fitness|outdoor')
  const sort = Math.floor(asNumber(body.sort) ?? 0)
  const attributes = parseAttributes(body.attributes)

  const db = getDb()
  if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) {
    throw httpError(409, `category slug "${slug}" already exists`)
  }
  db.exec('BEGIN')
  let id = 0
  try {
    const inserted = db
      .prepare(
        `INSERT INTO categories (slug, name, icon, color, grp, sort) VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(slug, name, icon, color, grp, sort) as { id: number }
    id = inserted.id
    insertAttributes(id, attributes)
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // already rolled back
    }
    throw err
  }
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow
  json(ctx.res, 201, { category: categoryJson(cat) })
}

/** PUT /api/admin/categories/:id — edit fields; attributes replaced when given. */
export async function adminUpdateCategory(ctx: Ctx): Promise<void> {
  requireAdmin(ctx)
  const id = asNumber(ctx.params.id)
  if (id === null) throw httpError(400, 'invalid category id')
  const db = getDb()
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined
  if (!existing) throw httpError(404, 'category not found')

  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const sets: string[] = []
  const params: Array<string | number> = []
  if (body.slug !== undefined) {
    const slug = asTrimmed(body.slug, 60)
    if (!isKebabSlug(slug)) throw httpError(400, 'slug must be kebab-case (2–60 chars)')
    const clash = db.prepare('SELECT 1 FROM categories WHERE slug = ? AND id <> ?').get(slug, id)
    if (clash) throw httpError(409, `category slug "${slug}" already exists`)
    sets.push('slug = ?')
    params.push(slug)
  }
  if (body.name !== undefined) {
    sets.push('name = ?')
    params.push(requireString(body, 'name', 1, 60))
  }
  if (body.icon !== undefined) {
    sets.push('icon = ?')
    params.push(optString(body, 'icon', 16) || '📍')
  }
  if (body.color !== undefined) {
    const color = asTrimmed(body.color, 7)
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw httpError(400, 'color must be a #rrggbb hex value')
    sets.push('color = ?')
    params.push(color)
  }
  if (body.grp !== undefined) {
    const grp = asTrimmed(body.grp, 20)
    if (!['fitness', 'outdoor'].includes(grp)) throw httpError(400, 'grp must be fitness|outdoor')
    sets.push('grp = ?')
    params.push(grp)
  }
  if (body.sort !== undefined) {
    sets.push('sort = ?')
    params.push(Math.floor(asNumber(body.sort) ?? 0))
  }
  const attributes = body.attributes !== undefined ? parseAttributes(body.attributes) : null

  db.exec('BEGIN')
  try {
    if (sets.length > 0) {
      db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
    }
    if (attributes) {
      db.prepare('DELETE FROM category_attributes WHERE category_id = ?').run(id)
      insertAttributes(id, attributes)
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
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow
  json(ctx.res, 200, { category: categoryJson(cat) })
}

// ── Stats dashboard ──────────────────────────────────────────────────────────

/** GET /api/admin/stats — table counts for the admin dashboard. */
export async function adminStats(ctx: Ctx): Promise<void> {
  requireAdmin(ctx)
  const db = getDb()
  const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c
  json(ctx.res, 200, {
    stats: {
      users: count('SELECT COUNT(*) AS c FROM users'),
      categories: count('SELECT COUNT(*) AS c FROM categories'),
      places_published: count(`SELECT COUNT(*) AS c FROM places WHERE status = 'published'`),
      places_pending: count(`SELECT COUNT(*) AS c FROM places WHERE status = 'pending'`),
      places_removed: count(`SELECT COUNT(*) AS c FROM places WHERE status = 'removed'`),
      places_osm: count(`SELECT COUNT(*) AS c FROM places WHERE source = 'osm'`),
      places_community: count(`SELECT COUNT(*) AS c FROM places WHERE source = 'community'`),
      photos: count('SELECT COUNT(*) AS c FROM photos'),
      comments: count(`SELECT COUNT(*) AS c FROM comments WHERE status = 'published'`),
      verifications: count('SELECT COUNT(*) AS c FROM verifications'),
      favorites: count('SELECT COUNT(*) AS c FROM favorites'),
      reports_open: count(`SELECT COUNT(*) AS c FROM reports WHERE status = 'open'`),
      reports_total: count('SELECT COUNT(*) AS c FROM reports'),
      events: count('SELECT COUNT(*) AS c FROM events'),
    },
  })
}

// ── Funnel analytics ─────────────────────────────────────────────────────────

// The 10 contract event types (CONTRACTS §6, server/routes/events.ts) — totals
// are zero-filled over this set so dashboards render stable keys.
const FUNNEL_EVENT_TYPES = [
  'category_selected',
  'search_performed',
  'place_viewed',
  'place_saved',
  'add_place_started',
  'place_submitted',
  'place_verified',
  'place_reported',
  'filter_applied',
  'near_me_used',
]

/**
 * GET /api/admin/funnel?days=30 — validation metrics (SEO_STRATEGY §8.4) from
 * the events table. `days` clamps to 1..365 (default 30). Events with NULL
 * client_id count in totals but not in unique_clients (contract amendment A1).
 */
export async function adminFunnel(ctx: Ctx): Promise<void> {
  requireAdmin(ctx)
  const days = clampInt(ctx.query.get('days'), 1, 365, 30)
  const db = getDb()
  const since = `-${days} days`

  const totals: Record<string, number> = {}
  for (const type of FUNNEL_EVENT_TYPES) totals[type] = 0
  const totalRows = db
    .prepare(
      `SELECT type, COUNT(*) AS c FROM events
       WHERE created_at >= datetime('now', ?) GROUP BY type`,
    )
    .all(since) as Array<{ type: string; c: number }>
  for (const row of totalRows) totals[row.type] = row.c

  const uniques = db
    .prepare(
      `SELECT COUNT(DISTINCT client_id) AS c FROM events
       WHERE created_at >= datetime('now', ?) AND client_id IS NOT NULL`,
    )
    .get(since) as { c: number }

  const byDay = db
    .prepare(
      `SELECT date(created_at) AS date, type, COUNT(*) AS count FROM events
       WHERE created_at >= datetime('now', ?)
       GROUP BY date(created_at), type ORDER BY date, type`,
    )
    .all(since) as Array<{ date: string; type: string; count: number }>

  json(ctx.res, 200, { days, totals, unique_clients: uniques.c, by_day: byDay })
}

// Re-exported so the router can do admin guard checks in one place if needed.
export { requireAdmin }
export type { SessionUser }
