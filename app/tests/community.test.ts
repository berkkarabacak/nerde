// Community interactions (CONTRACTS §6, PRODUCT_SPEC §6.10/6.11/6.12/6.13):
// verify (latest-vote-wins), comments, save/unsave + /me/saved, reports + admin.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import {
  api,
  cleanupTmp,
  freshDb,
  insertPlace,
  insertUser,
  sessionCookie,
  signupAndCookie,
  startServer,
} from './helpers.ts'
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

async function loginCookie(email: string, password: string): Promise<string> {
  const res = await api(server.base, 'POST', '/api/auth/login', { body: { email, password } })
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`)
  return sessionCookie(res.setCookie)
}

describe('verify (PRODUCT_SPEC §6.11)', () => {
  it('confirm increments confirm_count and sets last_verified_at', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'v1@example.com', 'verifier1', 'password-123')
    const res = await api(server.base, 'POST', `/api/places/${place.id}/verify`, {
      body: { type: 'confirm' },
      cookie,
    })
    expect(res.status).toBe(200)
    expect(res.body?.confirm_count).toBe(1)
    expect(res.body?.issue_count).toBe(0)
    expect(res.body?.last_verified_at).toMatch(/^\d{4}-\d{2}-\d{2} /) // UTC datetime string
    const row = db.prepare('SELECT confirm_count, last_verified_at FROM places WHERE id = ?').get(place.id) as any
    expect(row.confirm_count).toBe(1)
    expect(row.last_verified_at).not.toBeNull()
    // History stored as an append-only log row.
    const log = db.prepare('SELECT type FROM verifications WHERE place_id = ?').all(place.id) as any[]
    expect(log.map((r) => r.type)).toEqual(['confirm'])
  })

  it('latest vote wins: issue from a second user, then vote change recomputes counters', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const alice = await signupAndCookie(server.base, 'alice@example.com', 'alice', 'password-123')
    const bob = await signupAndCookie(server.base, 'bob@example.com', 'bobby', 'password-123')
    await api(server.base, 'POST', `/api/places/${place.id}/verify`, { body: { type: 'confirm' }, cookie: alice })
    const issue = await api(server.base, 'POST', `/api/places/${place.id}/verify`, {
      body: { type: 'issue', note: 'bars removed' },
      cookie: bob,
    })
    expect(issue.body).toMatchObject({ confirm_count: 1, issue_count: 1 })
    // Bob changes his mind → his latest vote replaces the old one (no double-count).
    const changed = await api(server.base, 'POST', `/api/places/${place.id}/verify`, {
      body: { type: 'confirm' },
      cookie: bob,
    })
    expect(changed.body).toMatchObject({ confirm_count: 2, issue_count: 0 })
    const logCount = db.prepare('SELECT COUNT(*) AS c FROM verifications WHERE place_id = ?').get(place.id) as any
    expect(logCount.c).toBe(3) // log keeps full history; counters are derived
  })

  it('issue does NOT move last_verified_at', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'v2@example.com', 'verifier2', 'password-123')
    const res = await api(server.base, 'POST', `/api/places/${place.id}/verify`, {
      body: { type: 'issue' },
      cookie,
    })
    expect(res.body?.issue_count).toBe(1)
    expect(res.body?.last_verified_at).toBeNull()
  })

  it('guest → 401; bad type → 400; unknown place → 404', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const guest = await api(server.base, 'POST', `/api/places/${place.id}/verify`, { body: { type: 'confirm' } })
    expect(guest.status).toBe(401)
    const cookie = await signupAndCookie(server.base, 'v3@example.com', 'verifier3', 'password-123')
    const badType = await api(server.base, 'POST', `/api/places/${place.id}/verify`, {
      body: { type: 'maybe' },
      cookie,
    })
    expect(badType.status).toBe(400)
    const missing = await api(server.base, 'POST', `/api/places/99999/verify`, {
      body: { type: 'confirm' },
      cookie,
    })
    expect(missing.status).toBe(404)
  })
})

describe('save/unsave + /me/saved (PRODUCT_SPEC §6.10)', () => {
  it('requires auth (401 for guests) on save and me/saved', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    expect((await api(server.base, 'POST', `/api/places/${place.id}/save`)).status).toBe(401)
    expect((await api(server.base, 'DELETE', `/api/places/${place.id}/save`)).status).toBe(401)
    expect((await api(server.base, 'GET', '/api/me/saved')).status).toBe(401)
  })

  it('save → listed in /me/saved; unsave removes; save is idempotent', async () => {
    const p1 = insertPlace(db, { name: 'Saved One', lat: 10, lng: 10 })
    const p2 = insertPlace(db, { name: 'Saved Two', lat: 11, lng: 11 })
    const cookie = await signupAndCookie(server.base, 'saver@example.com', 'saver', 'password-123')
    expect((await api(server.base, 'POST', `/api/places/${p1.id}/save`, { cookie })).body?.saved).toBe(true)
    await api(server.base, 'POST', `/api/places/${p2.id}/save`, { cookie })
    await api(server.base, 'POST', `/api/places/${p1.id}/save`, { cookie }) // duplicate save → INSERT OR IGNORE
    const saved = await api(server.base, 'GET', '/api/me/saved', { cookie })
    expect(saved.status).toBe(200)
    expect(saved.body?.places.map((p: any) => p.name).sort()).toEqual(['Saved One', 'Saved Two'])
    const unsaved = await api(server.base, 'DELETE', `/api/places/${p1.id}/save`, { cookie })
    expect(unsaved.body?.saved).toBe(false)
    const after = await api(server.base, 'GET', '/api/me/saved', { cookie })
    expect(after.body?.places.map((p: any) => p.name)).toEqual(['Saved Two'])
    // saved_by_me flag on the detail endpoint reflects state.
    const detail = await api(server.base, 'GET', `/api/places/${p2.slug}`, { cookie })
    expect(detail.body?.place.saved_by_me).toBe(true)
  })
})

describe('comments (PRODUCT_SPEC §6.12)', () => {
  it('guest → 401; 501-char body → 400; valid comment → 201 and visible on detail', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const guest = await api(server.base, 'POST', `/api/places/${place.id}/comments`, { body: { body: 'hi' } })
    expect(guest.status).toBe(401)
    const cookie = await signupAndCookie(server.base, 'c@example.com', 'commenter', 'password-123')
    const tooLong = await api(server.base, 'POST', `/api/places/${place.id}/comments`, {
      body: { body: 'x'.repeat(501) },
      cookie,
    })
    expect(tooLong.status).toBe(400)
    const empty = await api(server.base, 'POST', `/api/places/${place.id}/comments`, {
      body: { body: '   ' },
      cookie,
    })
    expect(empty.status).toBe(400)
    const ok = await api(server.base, 'POST', `/api/places/${place.id}/comments`, {
      body: { body: 'Great spot, bars in good shape.' },
      cookie,
    })
    expect(ok.status).toBe(201)
    expect(ok.body?.comment).toMatchObject({ username: 'commenter', body: 'Great spot, bars in good shape.' })
    const detail = await api(server.base, 'GET', `/api/places/${place.slug}`)
    expect(detail.body?.place.comments[0]).toMatchObject({ username: 'commenter' })
  })
})

describe('reports + admin moderation (PRODUCT_SPEC §6.12/6.13)', () => {
  it('guest can report → 201, row is open and listed for admin', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const res = await api(server.base, 'POST', `/api/places/${place.id}/report`, {
      body: { reason: 'place no longer exists', note: 'visited last week' },
    })
    expect(res.status).toBe(201)
    const row = db.prepare('SELECT * FROM reports').get() as any
    expect(row.status).toBe('open')
    expect(row.user_id).toBeNull() // anonymous

    const adminUser = insertUser(db, 'admin', { email: 'root@example.com', username: 'root', password: 'admin-pass-1' })
    const adminCookie = await loginCookie('root@example.com', 'admin-pass-1')
    const list = await api(server.base, 'GET', '/api/admin/reports?status=open', { cookie: adminCookie })
    expect(list.status).toBe(200)
    expect(list.body?.reports).toHaveLength(1)
    expect(list.body?.reports[0]).toMatchObject({ reason: 'place no longer exists', reporter_username: null })

    const resolved = await api(server.base, 'POST', `/api/admin/reports/${row.id}`, {
      body: { status: 'resolved' },
      cookie: adminCookie,
    })
    expect(resolved.status).toBe(200)
    const openAfter = await api(server.base, 'GET', '/api/admin/reports?status=open', { cookie: adminCookie })
    expect(openAfter.body?.reports).toHaveLength(0)
    expect(adminUser.id).toBeGreaterThan(0)
  })

  it('non-admin user → 403 on admin endpoints; guest → 403', async () => {
    const cookie = await signupAndCookie(server.base, 'pleb@example.com', 'pleb', 'password-123')
    for (const [method, path, body] of [
      ['GET', '/api/admin/reports', undefined],
      ['GET', '/api/admin/stats', undefined],
      ['POST', '/api/admin/reports/1', { status: 'resolved' }],
      ['POST', '/api/admin/places/1', { action: 'remove' }],
    ] as const) {
      const asUser = await api(server.base, method, path, { body, cookie })
      expect(asUser.status).toBe(403)
      const asGuest = await api(server.base, method, path, { body })
      expect(asGuest.status).toBe(403)
    }
  })

  it('admin place remove hides it from public APIs; restore brings it back', async () => {
    const place = insertPlace(db, { name: 'Moderated', lat: 10, lng: 10 })
    insertUser(db, 'admin', { email: 'root@example.com', username: 'root', password: 'admin-pass-1' })
    const adminCookie = await loginCookie('root@example.com', 'admin-pass-1')
    const removed = await api(server.base, 'POST', `/api/admin/places/${place.id}`, {
      body: { action: 'remove' },
      cookie: adminCookie,
    })
    expect(removed.body?.status).toBe('removed')
    expect((await api(server.base, 'GET', `/api/places/${place.slug}`)).status).toBe(404)
    const list = await api(server.base, 'GET', '/api/places?bbox=-180,-90,180,90')
    expect(list.body?.places).toHaveLength(0)
    await api(server.base, 'POST', `/api/admin/places/${place.id}`, {
      body: { action: 'restore' },
      cookie: adminCookie,
    })
    expect((await api(server.base, 'GET', `/api/places/${place.slug}`)).status).toBe(200)
  })
})
