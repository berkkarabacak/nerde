// GET /api/search?q= — categories by name + places by name/description LIKE,
// limit 8 each (CONTRACTS §6).
import { getDb } from '../db.ts'
import { json } from '../http.ts'
import type { Ctx } from '../http.ts'
import { SUMMARY_SELECT, hydrateSummaries } from '../placeData.ts'
import type { AttrDefRow, CategoryRow, SummaryRow } from '../placeData.ts'
import { escapeLike } from '../validate.ts'

export async function search(ctx: Ctx): Promise<void> {
  const q = (ctx.query.get('q') ?? '').trim().slice(0, 100)
  if (!q) {
    json(ctx.res, 200, { categories: [], places: [] })
    return
  }
  const like = escapeLike(q)
  const db = getDb()

  const categories = (
    db
      .prepare(`SELECT * FROM categories WHERE name LIKE '%' || ? || '%' ESCAPE '\\' ORDER BY grp, sort, id LIMIT 8`)
      .all(like) as CategoryRow[]
  ).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    icon: c.icon,
    color: c.color,
    grp: c.grp,
    sort: c.sort,
    attributes: (
      db
        .prepare('SELECT * FROM category_attributes WHERE category_id = ? ORDER BY sort, id')
        .all(c.id) as AttrDefRow[]
    ).map((a) => ({
      key: a.key,
      label: a.label,
      type: a.type,
      options: a.options ? (JSON.parse(a.options) as string[]) : null,
      filterable: Boolean(a.filterable),
      sort: a.sort,
    })),
  }))

  const rows = db
    .prepare(
      `${SUMMARY_SELECT}
       WHERE p.status = 'published'
         AND (p.name LIKE '%' || ? || '%' ESCAPE '\\' OR p.description LIKE '%' || ? || '%' ESCAPE '\\')
       ORDER BY p.confirm_count DESC, p.id LIMIT 8`,
    )
    .all(like, like) as SummaryRow[]

  json(ctx.res, 200, { categories, places: hydrateSummaries(rows) })
}
