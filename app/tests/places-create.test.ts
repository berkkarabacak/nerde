// POST /api/places (CONTRACTS §6, PRODUCT_SPEC §6.8): validation, slug shape,
// honeypot, duplicate scan (≤100 m AND shared category / name-similar), force.
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

const VALID = {
  name: 'Kuruçeşme Calisthenics Park',
  description: 'Outdoor rigs by the water',
  lat: 41.05,
  lng: 29.03,
  categories: ['calisthenics'],
  attrs: { 'calisthenics.pull_up_bars': true, 'calisthenics.free': true },
  city: 'Istanbul',
  country: 'Türkiye',
  country_code: 'tr',
}

describe('POST /api/places', () => {
  it('creates a place as a guest → 201 with kebab slug + 4-char suffix', async () => {
    const res = await api(server.base, 'POST', '/api/places', { body: VALID })
    expect(res.status).toBe(201)
    expect(res.body?.place.id).toBeGreaterThan(0)
    expect(res.body?.place.slug).toMatch(/^kurucesme-calisthenics-park-[a-z0-9]{4}$/)
    // Row persisted with category link, namespaced attrs, uppercased country code.
    const row = db.prepare('SELECT * FROM places WHERE id = ?').get(res.body!.place.id) as any
    expect(row.country_code).toBe('TR')
    expect(JSON.parse(row.attrs)).toEqual({ 'calisthenics.pull_up_bars': true, 'calisthenics.free': true })
    const cats = db.prepare('SELECT COUNT(*) AS c FROM place_categories WHERE place_id = ?').get(row.id) as any
    expect(cats.c).toBe(1)
    // Immediately visible (reactive moderation, spec §8.3).
    const detail = await api(server.base, 'GET', `/api/places/${res.body!.place.slug}`)
    expect(detail.status).toBe(200)
    expect(detail.body?.place.name).toBe(VALID.name)
  })

  it('rejects invalid coordinates (lat 91 / lng -181) with 400', async () => {
    const badLat = await api(server.base, 'POST', '/api/places', { body: { ...VALID, lat: 91 } })
    expect(badLat.status).toBe(400)
    const badLng = await api(server.base, 'POST', '/api/places', { body: { ...VALID, lng: -181 } })
    expect(badLng.status).toBe(400)
  })

  it('rejects zero categories and unknown categories with 400', async () => {
    const none = await api(server.base, 'POST', '/api/places', { body: { ...VALID, categories: [] } })
    expect(none.status).toBe(400)
    const unknown = await api(server.base, 'POST', '/api/places', {
      body: { ...VALID, categories: ['ufology'] },
    })
    expect(unknown.status).toBe(400)
  })

  it('rejects bad names, attr keys from other categories, and wrong attr types', async () => {
    const shortName = await api(server.base, 'POST', '/api/places', { body: { ...VALID, name: 'x' } })
    expect(shortName.status).toBe(400)
    const wrongCatAttr = await api(server.base, 'POST', '/api/places', {
      body: { ...VALID, attrs: { 'vanlife.quiet': true } },
    })
    expect(wrongCatAttr.status).toBe(400)
    const wrongType = await api(server.base, 'POST', '/api/places', {
      body: { ...VALID, attrs: { 'calisthenics.pull_up_bars': 'yes' } },
    })
    expect(wrongType.status).toBe(400)
    const badEnum = await api(server.base, 'POST', '/api/places', {
      body: { ...VALID, attrs: { 'calisthenics.indoor_outdoor': 'sideways' } },
    })
    expect(badEnum.status).toBe(400)
  })

  it('honeypot: filled `website` field → fake 201 but NO row is written', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS c FROM places').get() as any).c
    const res = await api(server.base, 'POST', '/api/places', {
      body: { ...VALID, name: 'Spam Bot Submission', website: 'http://spam.example' },
    })
    expect(res.status).toBe(201)
    expect(res.body?.place.slug).toBe('submitted')
    const after = (db.prepare('SELECT COUNT(*) AS c FROM places').get() as any).c
    expect(after).toBe(before)
    const spam = db.prepare(`SELECT 1 FROM places WHERE name = 'Spam Bot Submission'`).get()
    expect(spam).toBeUndefined()
  })

  it('duplicate ≤100 m with shared category → 409 {duplicates}; force:true → 201', async () => {
    const first = await api(server.base, 'POST', '/api/places', { body: VALID })
    expect(first.status).toBe(201)
    // ~50 m away, same category.
    const dupe = await api(server.base, 'POST', '/api/places', {
      body: { ...VALID, name: 'Different Name Entirely', lat: 41.0504, lng: 29.0301 },
    })
    expect(dupe.status).toBe(409)
    expect(dupe.body?.duplicates).toHaveLength(1)
    expect(dupe.body?.duplicates[0].slug).toBe(first.body?.place.slug)
    const forced = await api(server.base, 'POST', '/api/places', {
      body: { ...VALID, name: 'Different Name Entirely', lat: 41.0504, lng: 29.0301, force: true },
    })
    expect(forced.status).toBe(201)
  })

  it('duplicate scan: name-similar within 100 m triggers even without shared category', async () => {
    insertPlace(db, { name: 'Macka Park', lat: 41.05, lng: 29.03, cats: ['vanlife'] })
    const res = await api(server.base, 'POST', '/api/places', {
      body: { ...VALID, name: 'Macka Park', lat: 41.0503, lng: 29.0302 },
    })
    expect(res.status).toBe(409)
  })

  it('duplicate scan: >100 m away or different name+category does NOT trigger', async () => {
    insertPlace(db, { name: 'Macka Park', lat: 41.05, lng: 29.03, cats: ['calisthenics'] })
    // ~1 km away, same name — allowed.
    const far = await api(server.base, 'POST', '/api/places', { body: { ...VALID, name: 'Macka Park', lat: 41.06, lng: 29.03 } })
    expect(far.status).toBe(201)
    // 50 m away but different name AND different category — allowed.
    const other = await api(server.base, 'POST', '/api/places', {
      body: { ...VALID, name: 'Totally Other', categories: ['vanlife'], attrs: {}, lat: 41.0503, lng: 29.0302 },
    })
    expect(other.status).toBe(201)
  })
})
