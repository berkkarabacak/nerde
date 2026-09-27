// Bake the Nerde SQLite DB into static JSON for the GitHub Pages demo build
// (no Node API on static hosting — src/lib/demo.ts serves these files).
//
// Run: node scripts/bake-static-api.ts
//
// Output (demo-static/):
//   categories.json           — exact GET /api/categories payload (incl. place_count)
//   places.json               — {places:[PlaceSummary & {attrs}]} for all published places
//   details/<categorySlug>.json — {<placeSlug>: PlaceDetail} per category
//   slug-index.json           — {<placeSlug>: "<firstCategorySlug>"}
//
// Assembly mirrors server/placeData.ts (hydrateSummaries + assemblePlaceDetail)
// and server/routes/categories.ts exactly, minus auth-dependent fields
// (saved_by_me is always false; can_edit is omitted — not in the pinned type).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rawDbPath = process.env.NERDE_DB_PATH ?? './db/nerde.sqlite'
const DB_PATH = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(APP_ROOT, rawDbPath)
const OUT_DIR = path.join(APP_ROOT, 'demo-static')

// ── Row types (mirror server/placeData.ts) ───────────────────────────────────

interface CategoryRow {
  id: number
  slug: string
  name: string
  icon: string
  color: string
  grp: string
  sort: number
}

interface AttrDefRow {
  id: number
  category_id: number
  key: string
  label: string
  type: 'bool' | 'enum' | 'number' | 'text'
  options: string | null
  filterable: number
  sort: number
}

interface PlaceRow {
  id: number
  slug: string
  name: string
  lat: number
  lng: number
  description: string
  address: string
  city: string
  region: string
  country: string
  country_code: string
  attrs: string
  status: string
  source: string
  created_by: number | null
  created_at: string
  last_verified_at: string | null
  confirm_count: number
  issue_count: number
}

interface CategoryRef {
  slug: string
  name: string
  icon: string
  color: string
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function bake(): void {
  const db = new DatabaseSync(DB_PATH, { readOnly: true })

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT_DIR, 'details'), { recursive: true })

  const written: Array<{ file: string; bytes: number }> = []
  const writeJson = (rel: string, value: unknown): void => {
    const file = path.join(OUT_DIR, rel)
    const body = JSON.stringify(value)
    fs.writeFileSync(file, body)
    written.push({ file: rel, bytes: Buffer.byteLength(body) })
  }

  // ── categories.json (exact GET /api/categories payload) ──────────────────
  const categories = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM place_categories pc
               JOIN places p ON p.id = pc.place_id
               WHERE pc.category_id = c.id AND p.status = 'published') AS place_count
       FROM categories c ORDER BY grp, sort, id`,
    )
    .all() as Array<CategoryRow & { place_count: number }>
  const attrStmt = db.prepare(
    'SELECT * FROM category_attributes WHERE category_id = ? ORDER BY sort, id',
  )
  writeJson('categories.json', {
    categories: categories.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      icon: c.icon,
      color: c.color,
      grp: c.grp,
      sort: c.sort,
      place_count: c.place_count,
      attributes: (attrStmt.all(c.id) as AttrDefRow[]).map((a) => ({
        key: a.key,
        label: a.label,
        type: a.type,
        options: a.options ? (JSON.parse(a.options) as string[]) : null,
        filterable: Boolean(a.filterable),
        sort: a.sort,
      })),
    })),
  })

  // Attribute defs per category id (for attrs_resolved).
  const attrDefsByCat = new Map<number, AttrDefRow[]>()
  for (const c of categories) attrDefsByCat.set(c.id, attrStmt.all(c.id) as AttrDefRow[])

  // ── Shared lookups ─────────────────────────────────────────────────────────
  // Category refs per published place, in hydrateSummaries order (grp, sort, id).
  const catRefsByPlace = new Map<number, CategoryRef[]>()
  const catRows = db
    .prepare(
      `SELECT pc.place_id, c.slug, c.name, c.icon, c.color
       FROM place_categories pc
       JOIN categories c ON c.id = pc.category_id
       JOIN places p ON p.id = pc.place_id
       WHERE p.status = 'published'
       ORDER BY c.grp, c.sort, c.id`,
    )
    .all() as Array<{ place_id: number } & CategoryRef>
  for (const r of catRows) {
    const list = catRefsByPlace.get(r.place_id) ?? []
    list.push({ slug: r.slug, name: r.name, icon: r.icon, color: r.color })
    catRefsByPlace.set(r.place_id, list)
  }

  const photosByPlace = new Map<number, Array<{ url: string; width: number | null; height: number | null }>>()
  const photoRows = db
    .prepare(
      `SELECT ph.place_id, ph.url, ph.width, ph.height
       FROM photos ph JOIN places p ON p.id = ph.place_id
       WHERE p.status = 'published' ORDER BY ph.id`,
    )
    .all() as Array<{ place_id: number; url: string; width: number | null; height: number | null }>
  for (const r of photoRows) {
    const list = photosByPlace.get(r.place_id) ?? []
    list.push({ url: r.url, width: r.width, height: r.height })
    photosByPlace.set(r.place_id, list)
  }

  const commentsByPlace = new Map<number, Array<{ username: string; body: string; created_at: string }>>()
  const commentRows = db
    .prepare(
      `SELECT c.place_id, u.username, c.body, c.created_at
       FROM comments c
       JOIN users u ON u.id = c.user_id
       JOIN places p ON p.id = c.place_id
       WHERE p.status = 'published' AND c.status = 'published'
       ORDER BY c.id DESC`,
    )
    .all() as Array<{ place_id: number; username: string; body: string; created_at: string }>
  for (const r of commentRows) {
    const list = commentsByPlace.get(r.place_id) ?? []
    list.push({ username: r.username, body: r.body, created_at: r.created_at })
    commentsByPlace.set(r.place_id, list)
  }

  const usernameById = new Map<number, string>()
  for (const u of db.prepare('SELECT id, username FROM users').all() as Array<{ id: number; username: string }>) {
    usernameById.set(u.id, u.username)
  }

  // ── places.json + details/*.json + slug-index.json ─────────────────────────
  const placeRows = db
    .prepare(`SELECT * FROM places WHERE status = 'published' ORDER BY id`)
    .all() as PlaceRow[]

  const summaries: Array<Record<string, unknown>> = []
  const detailsByCat = new Map<string, Record<string, Record<string, unknown>>>()
  const slugIndex: Record<string, string> = {}
  let uncategorized = 0

  for (const row of placeRows) {
    const catRefs = catRefsByPlace.get(row.id) ?? []
    const photos = photosByPlace.get(row.id) ?? []
    const attrsJson = JSON.parse(row.attrs || '{}') as Record<string, unknown>

    const summary: Record<string, unknown> = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      categories: catRefs,
      photo_url: photos[0]?.url ?? null,
      confirm_count: row.confirm_count,
      last_verified_at: row.last_verified_at ?? null,
      city: row.city ?? '',
      country_code: row.country_code ?? '',
    }
    summaries.push({ ...summary, attrs: attrsJson })

    // attrs_resolved: for each of the place's categories, each defined attribute
    // present in the attrs JSON (server/placeData.ts assemblePlaceDetail).
    const catBySlug = new Map(categories.map((c) => [c.slug, c]))
    const attrsResolved: Array<Record<string, unknown>> = []
    for (const ref of catRefs) {
      const cat = catBySlug.get(ref.slug)
      if (!cat) continue
      for (const def of attrDefsByCat.get(cat.id) ?? []) {
        const fullKey = `${ref.slug}.${def.key}`
        if (Object.prototype.hasOwnProperty.call(attrsJson, fullKey)) {
          attrsResolved.push({
            category_slug: ref.slug,
            key: def.key,
            label: def.label,
            type: def.type,
            value: (attrsJson[fullKey] ?? null) as boolean | number | string | null,
          })
        }
      }
    }

    const detail: Record<string, unknown> = {
      ...summary,
      description: row.description,
      address: row.address,
      city: row.city,
      region: row.region,
      country: row.country,
      country_code: row.country_code,
      attrs_resolved: attrsResolved,
      photos,
      comments: commentsByPlace.get(row.id) ?? [],
      created_by_username: row.created_by !== null ? (usernameById.get(row.created_by) ?? null) : null,
      created_at: row.created_at,
      issue_count: row.issue_count,
      source: row.source,
      saved_by_me: false,
    }

    if (catRefs.length === 0) {
      uncategorized++
      continue // unreachable in the demo without a category detail file
    }
    for (const ref of catRefs) {
      const file = detailsByCat.get(ref.slug) ?? {}
      file[row.slug] = detail
      detailsByCat.set(ref.slug, file)
    }
    slugIndex[row.slug] = catRefs[0].slug
  }

  writeJson('places.json', { places: summaries })
  for (const [catSlug, places] of [...detailsByCat.entries()].sort()) {
    writeJson(`details/${catSlug}.json`, places)
  }
  writeJson('slug-index.json', slugIndex)

  // ── Size report ────────────────────────────────────────────────────────────
  const fmt = (n: number): string =>
    n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`
  let total = 0
  for (const w of written) {
    total += w.bytes
    console.log(`${fmt(w.bytes).padStart(9)}  ${w.file}`)
  }
  console.log('─'.repeat(40))
  console.log(`${fmt(total).padStart(9)}  TOTAL (${written.length} files, ${placeRows.length} published places)`)
  const placesSize = written.find((w) => w.file === 'places.json')?.bytes ?? 0
  if (placesSize > 6 * 1024 * 1024) {
    console.log(`NOTE: places.json exceeds 6 MB (${fmt(placesSize)}) — nothing dropped, as specified.`)
  }
  if (total > 15 * 1024 * 1024) {
    console.log(`WARNING: demo-static total exceeds the ~15 MB budget (${fmt(total)}).`)
  }
  if (uncategorized > 0) {
    console.log(`WARNING: ${uncategorized} published place(s) have no category — omitted from details/ and slug-index.json.`)
  }

  db.close()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bake()
}
