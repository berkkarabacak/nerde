// Community interaction routes: verify / comments / report / save.
// Verification counting follows DATABASE.md §5.4: the verifications log is
// append-only; cached counters on places are recomputed from the latest
// vote per user inside the same transaction.
import { getDb } from '../db.ts'
import { requireAuth } from '../auth.ts'
import { httpError, json } from '../http.ts'
import type { Ctx } from '../http.ts'
import { getPlaceById } from '../placeData.ts'
import { asNumber, optString, readJson, requireString } from '../validate.ts'

function placeIdParam(ctx: Ctx): number {
  const id = asNumber(ctx.params.id)
  if (id === null || id <= 0) throw httpError(400, 'invalid place id')
  return id
}

// ── POST /api/places/:id/verify (auth) ───────────────────────────────────────

export async function verifyPlace(ctx: Ctx): Promise<void> {
  const user = requireAuth(ctx)
  const placeId = placeIdParam(ctx)
  const place = getPlaceById(placeId)
  if (!place) throw httpError(404, 'place not found')

  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const type = body.type === 'confirm' || body.type === 'issue' ? body.type : null
  if (!type) throw httpError(400, `type must be 'confirm' or 'issue'`)
  const note = optString(body, 'note', 500)

  const db = getDb()
  db.exec('BEGIN')
  try {
    // (b) append the new event — the log is never updated/deleted.
    db.prepare('INSERT INTO verifications (place_id, user_id, type, note) VALUES (?, ?, ?, ?)').run(
      placeId,
      user.id,
      type,
      note,
    )
    // Recompute the cached counters from the latest vote per user (the log is
    // the source of truth — "latest wins").
    const counts = db
      .prepare(
        `WITH latest AS (
           SELECT user_id, MAX(id) AS id FROM verifications
           WHERE place_id = ? GROUP BY user_id
         )
         SELECT COALESCE(SUM(v.type = 'confirm'), 0) AS confirm_count,
                COALESCE(SUM(v.type = 'issue'), 0)   AS issue_count
         FROM verifications v JOIN latest l ON l.id = v.id`,
      )
      .get(placeId) as { confirm_count: number; issue_count: number }
    // last_verified_at moves on 'confirm' only (DATABASE.md §5.4c).
    db.prepare(
      `UPDATE places SET
         confirm_count = ?,
         issue_count = ?,
         last_verified_at = CASE WHEN ? = 'confirm' THEN datetime('now') ELSE last_verified_at END,
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(counts.confirm_count, counts.issue_count, type, placeId)
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // already rolled back
    }
    throw err
  }

  const fresh = getDb()
    .prepare('SELECT confirm_count, issue_count, last_verified_at FROM places WHERE id = ?')
    .get(placeId) as { confirm_count: number; issue_count: number; last_verified_at: string | null }
  json(ctx.res, 200, {
    ok: true,
    confirm_count: fresh.confirm_count,
    issue_count: fresh.issue_count,
    last_verified_at: fresh.last_verified_at,
  })
}

// ── POST /api/places/:id/comments (auth) ─────────────────────────────────────

export async function addComment(ctx: Ctx): Promise<void> {
  const user = requireAuth(ctx)
  const placeId = placeIdParam(ctx)
  if (!getPlaceById(placeId)) throw httpError(404, 'place not found')

  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const text = requireString(body, 'body', 1, 500)
  const inserted = getDb()
    .prepare(
      `INSERT INTO comments (place_id, user_id, body) VALUES (?, ?, ?)
       RETURNING id, created_at`,
    )
    .get(placeId, user.id, text) as { id: number; created_at: string }
  json(ctx.res, 201, {
    comment: { id: inserted.id, username: user.username, body: text, created_at: inserted.created_at },
  })
}

// ── POST /api/places/:id/report (auth optional) ──────────────────────────────

export async function reportPlace(ctx: Ctx): Promise<void> {
  const placeId = placeIdParam(ctx)
  if (!getPlaceById(placeId)) throw httpError(404, 'place not found')

  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const reason = requireString(body, 'reason', 1, 200)
  const note = optString(body, 'note', 1000)
  getDb()
    .prepare('INSERT INTO reports (place_id, user_id, reason, note) VALUES (?, ?, ?, ?)')
    .run(placeId, ctx.user?.id ?? null, reason, note)
  json(ctx.res, 201, { ok: true })
}

// ── POST|DELETE /api/places/:id/save (auth) ──────────────────────────────────

export async function savePlace(ctx: Ctx): Promise<void> {
  const user = requireAuth(ctx)
  const placeId = placeIdParam(ctx)
  if (!getPlaceById(placeId)) throw httpError(404, 'place not found')
  getDb().prepare('INSERT OR IGNORE INTO favorites (user_id, place_id) VALUES (?, ?)').run(user.id, placeId)
  json(ctx.res, 200, { saved: true })
}

export async function unsavePlace(ctx: Ctx): Promise<void> {
  const user = requireAuth(ctx)
  const placeId = placeIdParam(ctx)
  getDb().prepare('DELETE FROM favorites WHERE user_id = ? AND place_id = ?').run(user.id, placeId)
  json(ctx.res, 200, { saved: false })
}
