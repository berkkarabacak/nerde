// GET /api/categories (CONTRACTS §6 + amendments): attribute definitions and
// the live published-place count per category (CRITICAL_REVIEW B3 — chips must
// show counts so empty categories stop being a broken promise).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { api, cleanupTmp, freshDb, insertPlace, startServer } from './helpers.ts'
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

describe('GET /api/categories place_count', () => {
  it('reports the published-place count per category, 0 for empty ones', async () => {
    insertPlace(db, { name: 'Bars A', lat: 10, lng: 10, cats: ['calisthenics'] })
    insertPlace(db, { name: 'Bars B', lat: 10.01, lng: 10.01, cats: ['calisthenics'] })
    insertPlace(db, { name: 'Van', lat: 20, lng: 20, cats: ['vanlife'] })
    const res = await api(server.base, 'GET', '/api/categories')
    expect(res.status).toBe(200)
    const bySlug = new Map<string, any>(res.body?.categories.map((c: any) => [c.slug, c]))
    expect(bySlug.get('calisthenics')?.place_count).toBe(2)
    expect(bySlug.get('vanlife')?.place_count).toBe(1)
    // Seeded but empty categories stay visible with an honest zero.
    expect(bySlug.get('arm-wrestling')?.place_count).toBe(0)
    expect(bySlug.get('sunset-spots')?.place_count).toBe(0)
  })

  it('counts only published places (pending/removed excluded)', async () => {
    insertPlace(db, { name: 'Live', lat: 10, lng: 10, cats: ['calisthenics'] })
    insertPlace(db, { name: 'Pending', lat: 10.01, lng: 10.01, cats: ['calisthenics'], status: 'pending' })
    insertPlace(db, { name: 'Gone', lat: 10.02, lng: 10.02, cats: ['calisthenics'], status: 'removed' })
    const res = await api(server.base, 'GET', '/api/categories')
    const calis = res.body?.categories.find((c: any) => c.slug === 'calisthenics')
    expect(calis?.place_count).toBe(1)
  })

  it('a place in several categories counts once per category', async () => {
    insertPlace(db, { name: 'Multi', lat: 10, lng: 10, cats: ['calisthenics', 'vanlife'] })
    const res = await api(server.base, 'GET', '/api/categories')
    const bySlug = new Map<string, any>(res.body?.categories.map((c: any) => [c.slug, c]))
    expect(bySlug.get('calisthenics')?.place_count).toBe(1)
    expect(bySlug.get('vanlife')?.place_count).toBe(1)
  })

  it('category shape still matches CONTRACTS §6 (slug/name/icon/color/grp/sort/attributes)', async () => {
    const res = await api(server.base, 'GET', '/api/categories')
    const c = res.body?.categories.find((x: any) => x.slug === 'calisthenics')
    expect(Object.keys(c).sort()).toEqual(
      ['attributes', 'color', 'grp', 'icon', 'id', 'name', 'place_count', 'slug', 'sort'].sort(),
    )
    expect(c.attributes.length).toBeGreaterThan(0)
    expect(c.attributes[0]).toMatchObject({ key: expect.any(String), label: expect.any(String) })
  })
})
