// POST /api/events — first-party analytics. ALWAYS 204: tracking must never
// surface errors to the product UI. Unknown types and malformed payloads are
// dropped silently. The 10 event types are whitelisted (CONTRACTS §6,
// src/lib/api-types.ts EventType).
import { getDb } from '../db.ts'
import { noContent } from '../http.ts'
import type { Ctx } from '../http.ts'
import { readJson } from '../validate.ts'

const ALLOWED_TYPES = new Set([
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
])

export async function trackEvent(ctx: Ctx): Promise<void> {
  try {
    const body = (await readJson(ctx.req, 64_000)) as Record<string, unknown>
    const type = typeof body.type === 'string' ? body.type : ''
    if (ALLOWED_TYPES.has(type)) {
      let meta = '{}'
      let metaClientId: string | null = null
      if (body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) {
        // Legacy fallback (contract amendment, CRITICAL_REVIEW I2): older
        // clients nested client_id inside meta. Accept it, but lift it out so
        // meta stays clean analytics payload.
        const metaObj = { ...(body.meta as Record<string, unknown>) }
        if (typeof metaObj.client_id === 'string') {
          metaClientId = metaObj.client_id
          delete metaObj.client_id
        }
        const serialized = JSON.stringify(metaObj)
        if (serialized.length <= 2000) meta = serialized
      }
      const rawClientId =
        typeof body.client_id === 'string' ? body.client_id : metaClientId
      const clientId = rawClientId ? rawClientId.slice(0, 64) : null
      getDb()
        .prepare('INSERT INTO events (type, user_id, client_id, meta) VALUES (?, ?, ?, ?)')
        .run(type, ctx.user?.id ?? null, clientId, meta)
    }
  } catch {
    // Swallow by design — analytics must never fail the request.
  }
  noContent(ctx.res)
}
