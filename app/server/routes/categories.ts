// GET /api/categories — all categories with their attribute definitions and a
// live published-place count per category (contract amendment, CRITICAL_REVIEW
// B3: chips must not promise dead categories — the count is shown as a badge).
import { getDb } from '../db.ts'
import { json } from '../http.ts'
import type { Ctx } from '../http.ts'
import type { AttrDefRow, CategoryRow } from '../placeData.ts'

export async function listCategories(ctx: Ctx): Promise<void> {
  const db = getDb()
  // Single query: one correlated count per category (published places only).
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
  json(ctx.res, 200, {
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
}
