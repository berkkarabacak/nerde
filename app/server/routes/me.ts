// GET /api/me/saved + GET /api/me/places (auth).
import { getDb } from '../db.ts'
import { requireAuth } from '../auth.ts'
import { json } from '../http.ts'
import type { Ctx } from '../http.ts'
import { SUMMARY_SELECT, hydrateSummaries } from '../placeData.ts'
import type { SummaryRow } from '../placeData.ts'

/** Places the current user saved (favorites), newest save first. */
export async function mySaved(ctx: Ctx): Promise<void> {
  const user = requireAuth(ctx)
  const rows = getDb()
    .prepare(
      `${SUMMARY_SELECT}
       JOIN favorites f ON f.place_id = p.id
       WHERE f.user_id = ? AND p.status = 'published'
       ORDER BY f.created_at DESC, f.place_id DESC`,
    )
    .all(user.id) as SummaryRow[]
  json(ctx.res, 200, { places: hydrateSummaries(rows) })
}

/** Places the current user contributed, newest first (any non-removed status). */
export async function myPlaces(ctx: Ctx): Promise<void> {
  const user = requireAuth(ctx)
  const rows = getDb()
    .prepare(
      `${SUMMARY_SELECT}
       WHERE p.created_by = ? AND p.status <> 'removed'
       ORDER BY p.created_at DESC, p.id DESC`,
    )
    .all(user.id) as SummaryRow[]
  json(ctx.res, 200, { places: hydrateSummaries(rows) })
}
