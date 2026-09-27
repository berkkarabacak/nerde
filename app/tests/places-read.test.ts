// Read-side place queries (CONTRACTS §6, PRODUCT_SPEC §6.3/6.4/6.6):
// bbox filtering, category filter, attrs truthy filter, q search, limit cap,
// antimeridian wrap, /near haversine ordering + radius cutoff.
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

const WORLD = 'bbox=-180,-90,180,90'

describe('GET /api/places bbox', () => {
  it('returns places inside the bbox and excludes those outside', async () => {
    insertPlace(db, { name: 'Istanbul Park', lat: 41.0, lng: 29.0, cats: ['calisthenics'] })
    insertPlace(db, { name: 'Berlin Park', lat: 52.5, lng: 13.4, cats: ['calisthenics'] })
    const res = await api(server.base, 'GET', '/api/places?bbox=28,40,30,42')
    expect(res.status).toBe(200)
    expect(res.body?.places).toHaveLength(1)
    expect(res.body?.places[0].name).toBe('Istanbul Park')
  })

  it('returns only published places (pending/removed hidden)', async () => {
    insertPlace(db, { name: 'Live', lat: 10, lng: 10 })
    insertPlace(db, { name: 'Pending', lat: 10.001, lng: 10.001, status: 'pending' })
    insertPlace(db, { name: 'Gone', lat: 10.002, lng: 10.002, status: 'removed' })
    const res = await api(server.base, 'GET', `/api/places?${WORLD}`)
    expect(res.body?.places).toHaveLength(1)
    expect(res.body?.places[0].name).toBe('Live')
  })

  it('P1-02: a genuinely empty bbox returns places:[], total_count 0, truncated false (empty-CTA contract)', async () => {
    // The empty-area CTA in MapHome must only fire on this exact shape — a
    // real zero, never a loading artifact or a truncated sample.
    insertPlace(db, { name: 'Far Away', lat: 80, lng: 80, cats: ['calisthenics'] })
    const res = await api(server.base, 'GET', '/api/places?bbox=28,40,30,42')
    expect(res.status).toBe(200)
    expect(res.body?.places).toEqual([])
    expect(res.body?.total_count).toBe(0)
    expect(res.body?.truncated).toBe(false)
  })

  it('filters by category slug', async () => {
    insertPlace(db, { name: 'Calis Spot', lat: 10, lng: 10, cats: ['calisthenics'] })
    insertPlace(db, { name: 'Van Spot', lat: 10.01, lng: 10.01, cats: ['vanlife'] })
    const res = await api(server.base, 'GET', `/api/places?${WORLD}&cat=calisthenics`)
    expect(res.body?.places).toHaveLength(1)
    expect(res.body?.places[0].categories[0].slug).toBe('calisthenics')
  })

  it('attrs filter keeps only truthy values (bool true passes, false/missing fail)', async () => {
    insertPlace(db, {
      name: 'HasBars',
      lat: 10,
      lng: 10,
      cats: ['calisthenics'],
      attrs: { 'calisthenics.pull_up_bars': true, 'calisthenics.free': false },
    })
    insertPlace(db, {
      name: 'NoBars',
      lat: 10.01,
      lng: 10.01,
      cats: ['calisthenics'],
      attrs: { 'calisthenics.pull_up_bars': false },
    })
    insertPlace(db, { name: 'NothingSet', lat: 10.02, lng: 10.02, cats: ['calisthenics'] })
    const yes = await api(server.base, 'GET', `/api/places?${WORLD}&attrs=calisthenics.pull_up_bars`)
    expect(yes.body?.places).toHaveLength(1)
    expect(yes.body?.places[0].name).toBe('HasBars')
    // Enum values count as truthy.
    insertPlace(db, {
      name: 'OutdoorOnly',
      lat: 10.03,
      lng: 10.03,
      cats: ['calisthenics'],
      attrs: { 'calisthenics.indoor_outdoor': 'outdoor' },
    })
    const enumFilter = await api(server.base, 'GET', `/api/places?${WORLD}&attrs=calisthenics.indoor_outdoor`)
    expect(enumFilter.body?.places.map((p: any) => p.name)).toEqual(['OutdoorOnly'])
    // Multi-attr = AND semantics.
    const and = await api(
      server.base,
      'GET',
      `/api/places?${WORLD}&attrs=calisthenics.pull_up_bars,calisthenics.free`,
    )
    expect(and.body?.places).toHaveLength(0) // HasBars has free=false
  })

  it('unknown attribute filter → 400 (typo is not a silent empty result)', async () => {
    const res = await api(server.base, 'GET', `/api/places?${WORLD}&attrs=calisthenics.nope`)
    expect(res.status).toBe(400)
  })

  it('q matches name/description substrings, case-insensitive', async () => {
    insertPlace(db, { name: 'Maçka Calisthenics Park', lat: 10, lng: 10 })
    insertPlace(db, { name: 'Other', lat: 10.01, lng: 10.01, description: 'has pull-up rigs' })
    insertPlace(db, { name: 'Unrelated', lat: 10.02, lng: 10.02 })
    const byName = await api(server.base, 'GET', `/api/places?${WORLD}&q=calisthenics`)
    expect(byName.body?.places.map((p: any) => p.name)).toEqual(['Maçka Calisthenics Park'])
    const byDesc = await api(server.base, 'GET', `/api/places?${WORLD}&q=PULL-UP`)
    expect(byDesc.body?.places.map((p: any) => p.name)).toEqual(['Other'])
  })

  it('limit is capped at 1000 and smaller limits truncate', async () => {
    for (let i = 0; i < 3; i++) insertPlace(db, { name: `P${i}`, lat: 10 + i * 0.01, lng: 10 })
    const capped = await api(server.base, 'GET', `/api/places?${WORLD}&limit=99999`)
    expect(capped.status).toBe(200) // cap clamps silently, does not error
    expect(capped.body?.places).toHaveLength(3)
    const one = await api(server.base, 'GET', `/api/places?${WORLD}&limit=1`)
    expect(one.body?.places).toHaveLength(1)
  })

  it('response carries total_count + truncated (CRITICAL_REVIEW I1 — no silent truncation)', async () => {
    for (let i = 0; i < 3; i++) insertPlace(db, { name: `T${i}`, lat: 10 + i * 0.01, lng: 10 })
    // Full result: truncated=false, total_count equals the row count.
    const full = await api(server.base, 'GET', `/api/places?${WORLD}`)
    expect(full.body?.total_count).toBe(3)
    expect(full.body?.truncated).toBe(false)
    expect(full.body?.places).toHaveLength(3)
    // Truncated: total_count reports the FULL bbox count, places is a sample.
    const sample = await api(server.base, 'GET', `/api/places?${WORLD}&limit=2`)
    expect(sample.body?.total_count).toBe(3)
    expect(sample.body?.truncated).toBe(true)
    expect(sample.body?.places).toHaveLength(2)
  })

  it('truncated sampling is deterministic (same query → same subset, twice)', async () => {
    for (let i = 0; i < 10; i++) insertPlace(db, { name: `D${i}`, lat: 10 + i * 0.01, lng: 10 + i * 0.01 })
    const a = await api(server.base, 'GET', `/api/places?${WORLD}&limit=4`)
    const b = await api(server.base, 'GET', `/api/places?${WORLD}&limit=4`)
    expect(a.body?.places.map((p: any) => p.id)).toEqual(b.body?.places.map((p: any) => p.id))
    expect(a.body?.total_count).toBe(10)
    expect(a.body?.truncated).toBe(true)
  })

  it('antimeridian-crossing bbox returns places on both sides of ±180°', async () => {
    insertPlace(db, { name: 'Fiji East', lat: 0, lng: 179.5 })
    insertPlace(db, { name: 'Samoa West', lat: 0, lng: -179.5 })
    insertPlace(db, { name: 'Greenwich', lat: 0, lng: 0 })
    const res = await api(server.base, 'GET', '/api/places?bbox=170,-10,-170,10')
    expect(res.status).toBe(200)
    const names = res.body?.places.map((p: any) => p.name).sort()
    expect(names).toEqual(['Fiji East', 'Samoa West'])
  })

  it('rejects malformed bbox params with 400', async () => {
    for (const bad of ['1,2,3', 'a,b,c,d', '10,50,20,40']) {
      const res = await api(server.base, 'GET', `/api/places?bbox=${bad}`)
      expect(res.status).toBe(400)
    }
    const missing = await api(server.base, 'GET', '/api/places')
    expect(missing.status).toBe(400)
  })

  it('PlaceSummary shape matches CONTRACTS §6 (+A9 city/country_code)', async () => {
    insertPlace(db, { name: 'Shape Check', lat: 10, lng: 10, cats: ['vanlife'], city: 'Berlin', country_code: 'DE' })
    insertPlace(db, { name: 'No City', lat: 20, lng: 20, cats: ['vanlife'] })
    const res = await api(server.base, 'GET', `/api/places?${WORLD}`)
    const p = res.body?.places.find((x: any) => x.name === 'Shape Check')
    expect(Object.keys(p).sort()).toEqual(
      ['categories', 'city', 'confirm_count', 'country_code', 'id', 'last_verified_at', 'lat', 'lng', 'name', 'photo_url', 'slug'].sort(),
    )
    expect(p.categories[0]).toMatchObject({ slug: 'vanlife', name: 'Vanlife Spots' })
    // A9: populated city/country_code surface on the summary…
    expect(p.city).toBe('Berlin')
    expect(p.country_code).toBe('DE')
    // …and unset ones come back as empty strings, never missing/null.
    const bare = res.body?.places.find((x: any) => x.name === 'No City')
    expect(bare.city).toBe('')
    expect(bare.country_code).toBe('')
  })
})

describe('GET /api/places/near', () => {
  it('returns places sorted by ascending distance with distance_km', async () => {
    insertPlace(db, { name: 'Far', lat: 41.02, lng: 29.0 }) // ~2.2 km
    insertPlace(db, { name: 'Near', lat: 41.002, lng: 29.0 }) // ~0.2 km
    insertPlace(db, { name: 'Mid', lat: 41.01, lng: 29.0 }) // ~1.1 km
    const res = await api(server.base, 'GET', '/api/places/near?lat=41.0&lng=29.0&radius_km=30')
    expect(res.status).toBe(200)
    const names = res.body?.places.map((p: any) => p.name)
    expect(names).toEqual(['Near', 'Mid', 'Far'])
    const dists = res.body?.places.map((p: any) => p.distance_km)
    expect(dists[0]).toBeLessThan(dists[1])
    expect(dists[1]).toBeLessThan(dists[2])
    expect(dists[0]).toBeGreaterThan(0.1)
  })

  it('applies the radius cutoff as a haversine circle, not the square prefilter', async () => {
    insertPlace(db, { name: 'InCircle', lat: 41.1, lng: 29.0 }) // ~11.1 km north
    // NE diagonal ~16.1 km: inside the 15 km square prefilter corner, outside the circle.
    insertPlace(db, { name: 'SquareCornerOnly', lat: 41.09, lng: 29.15 })
    const tight = await api(server.base, 'GET', '/api/places/near?lat=41.0&lng=29.0&radius_km=10')
    expect(tight.body?.places).toEqual([]) // 11.1 km > 10 km cutoff
    const wide = await api(server.base, 'GET', '/api/places/near?lat=41.0&lng=29.0&radius_km=15')
    expect(wide.body?.places.map((p: any) => p.name)).toEqual(['InCircle'])
  })

  it('respects the category filter and validates coordinates', async () => {
    insertPlace(db, { name: 'Calis', lat: 41.001, lng: 29.0, cats: ['calisthenics'] })
    insertPlace(db, { name: 'Van', lat: 41.001, lng: 29.001, cats: ['vanlife'] })
    const res = await api(server.base, 'GET', '/api/places/near?lat=41&lng=29&cat=vanlife')
    expect(res.body?.places.map((p: any) => p.name)).toEqual(['Van'])
    expect((await api(server.base, 'GET', '/api/places/near?lat=91&lng=0')).status).toBe(400)
    expect((await api(server.base, 'GET', '/api/places/near?lat=0&lng=181')).status).toBe(400)
    expect((await api(server.base, 'GET', '/api/places/near?lng=0')).status).toBe(400)
  })
})
