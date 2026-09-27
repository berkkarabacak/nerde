// GET /api/admin/funnel tests — validation metrics (SEO_STRATEGY §8.4) over
// the events table: totals zero-filled across the 10 contract types,
// unique_clients from client_id (NULLs excluded from uniques, kept in totals),
// per-day breakdown, admin-only access, days clamped to 1..365.
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { api, cleanupTmp, freshDb, insertUser, startServer } from './helpers.ts'
import type { TestServer } from './helpers.ts'

let server: TestServer
let db: DatabaseSync

beforeAll(async () => {
  server = await startServer()
})
afterAll(async () => {
  await server.close()
  cleanupTmp()
})
beforeEach(() => {
  db = freshDb()
})

/** Direct session row for a fixture user (skips the login round-trip). */
function sessionFor(userId: number): string {
  const token = randomBytes(16).toString('hex')
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`).run(
    token,
    userId,
  )
  return `nerde_session=${token}`
}

const ALL_TYPES = [
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

function insertEvent(type: string, clientId: string | null, ageDays = 0): void {
  db.prepare(
    `INSERT INTO events (type, user_id, client_id, meta, created_at)
     VALUES (?, NULL, ?, '{}', datetime('now', ?))`,
  ).run(type, clientId, `-${ageDays} days`)
}

describe('GET /api/admin/funnel', () => {
  it('returns totals, unique_clients and by_day over the trailing N days', async () => {
    insertEvent('place_viewed', 'client-a')
    insertEvent('place_viewed', 'client-a') // same client twice
    insertEvent('place_viewed', 'client-b')
    insertEvent('place_saved', null) // NULL client_id: counts in totals, not uniques
    insertEvent('search_performed', 'client-b')
    insertEvent('place_viewed', 'client-old', 40) // outside the default window

    const admin = insertUser(db, 'admin')
    const res = await api(server.base, 'GET', '/api/admin/funnel', { cookie: sessionFor(admin.id) })
    expect(res.status).toBe(200)

    expect(res.body?.days).toBe(30)
    // Zero-filled across all 10 contract event types.
    expect(Object.keys(res.body?.totals ?? {}).sort()).toEqual(ALL_TYPES.slice().sort())
    expect(res.body?.totals.place_viewed).toBe(3)
    expect(res.body?.totals.place_saved).toBe(1)
    expect(res.body?.totals.search_performed).toBe(1)
    expect(res.body?.totals.near_me_used).toBe(0)

    expect(res.body?.unique_clients).toBe(2) // client-a, client-b

    const today = new Date().toISOString().slice(0, 10)
    expect(res.body?.by_day).toEqual([
      { date: today, type: 'place_saved', count: 1 },
      { date: today, type: 'place_viewed', count: 3 },
      { date: today, type: 'search_performed', count: 1 },
    ])
  })

  it('clamps days to 1..365 and defaults to 30', async () => {
    insertEvent('place_viewed', 'client-old', 40)
    const admin = insertUser(db, 'admin')
    const cookie = sessionFor(admin.id)

    const wide = await api(server.base, 'GET', '/api/admin/funnel?days=60', { cookie })
    expect(wide.body?.days).toBe(60)
    expect(wide.body?.totals.place_viewed).toBe(1) // the 40-day-old event is inside

    const narrow = await api(server.base, 'GET', '/api/admin/funnel?days=30', { cookie })
    expect(narrow.body?.totals.place_viewed).toBe(0)
    expect(narrow.body?.by_day).toEqual([])

    for (const [param, want] of [
      ['0', 1],
      ['-5', 1],
      ['9999', 365],
      ['abc', 30],
    ] as const) {
      const res = await api(server.base, 'GET', `/api/admin/funnel?days=${param}`, { cookie })
      expect(res.body?.days).toBe(want)
    }
  })

  it('rejects non-admin users and guests with 403', async () => {
    const user = insertUser(db, 'user')
    const asUser = await api(server.base, 'GET', '/api/admin/funnel', { cookie: sessionFor(user.id) })
    expect(asUser.status).toBe(403)
    const guest = await api(server.base, 'GET', '/api/admin/funnel')
    expect(guest.status).toBe(403)
  })
})
