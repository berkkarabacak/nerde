// Unit tests for the demo-mode client-side API (src/lib/demo.ts) — inline
// fixtures only, no DB, no fetch: the exported pure helpers carry the logic.
import { describe, expect, it } from 'vitest'
import {
  filterDemoPlaces,
  nearDemoPlaces,
  scatterScore,
  searchDemo,
} from '../src/lib/demo.ts'
import type { DemoPlace } from '../src/lib/demo.ts'
import type { Category } from '../src/lib/api-types.ts'

const CAT_CALI = { slug: 'calisthenics', name: 'Calisthenics Parks', icon: '🏋️', color: '#111111' }
const CAT_VAN = { slug: 'vanlife', name: 'Vanlife Spots', icon: '🚐', color: '#222222' }

const CATEGORIES = [
  {
    id: 1,
    ...CAT_CALI,
    grp: 'fitness',
    sort: 1,
    place_count: 3,
    attributes: [
      { key: 'pull_up_bars', label: 'Pull-up bars', type: 'bool', options: null, filterable: true, sort: 1 },
    ],
  },
  {
    id: 2,
    ...CAT_VAN,
    grp: 'outdoor',
    sort: 1,
    place_count: 1,
    attributes: [
      { key: 'free', label: 'Free', type: 'bool', options: null, filterable: true, sort: 1 },
      { key: 'mobile_signal', label: 'Mobile signal', type: 'enum', options: ['none', 'good'], filterable: false, sort: 2 },
    ],
  },
] as unknown as Category[]

function place(id: number, over: Partial<DemoPlace> = {}): DemoPlace {
  return {
    id,
    slug: `place-${id}`,
    name: `Place ${id}`,
    lat: 40,
    lng: 29,
    categories: [CAT_CALI],
    photo_url: null,
    confirm_count: 0,
    last_verified_at: null,
    city: '',
    country_code: '',
    attrs: {},
    ...over,
  }
}

// ── bbox filter ──────────────────────────────────────────────────────────────

describe('filterDemoPlaces bbox', () => {
  const places = [
    place(1, { lat: 41, lng: 29 }), // Istanbul
    place(2, { lat: 48.8, lng: 2.3 }), // Paris — outside
    place(3, { lat: -33.8, lng: 151.2 }), // Sydney — outside
  ]

  it('keeps places inside the bbox, drops the rest', () => {
    const res = filterDemoPlaces(places, { bbox: '25,38,35,44' })
    expect(res.places.map((p) => p.id)).toEqual([1])
    expect(res.total_count).toBe(1)
    expect(res.truncated).toBe(false)
  })

  it('is antimeridian-aware (w > e wraps the 180° meridian)', () => {
    const wrapped = [
      place(1, { lat: 0, lng: 179.5 }),
      place(2, { lat: 0, lng: -179.5 }),
      place(3, { lat: 0, lng: 0 }), // opposite side of the world
    ]
    const res = filterDemoPlaces(wrapped, { bbox: '170,-10,-170,10' })
    expect(res.places.map((p) => p.id).sort()).toEqual([1, 2])

    // Same longitudes through a non-wrapping bbox must NOT match.
    const narrow = filterDemoPlaces(wrapped, { bbox: '-10,-10,10,10' })
    expect(narrow.places.map((p) => p.id)).toEqual([3])
  })

  it('clamps lat and normalizes lng like the server', () => {
    // bbox lngs beyond ±180 normalize (w −540 → −180, e 540 → 180 = world band);
    // lat clamps to ±90. Place coords are always valid (server validates on write).
    const res = filterDemoPlaces([place(1, { lat: 85, lng: -160 })], { bbox: '-540,-95,540,95' })
    expect(res.places).toHaveLength(1)
  })

  it('rejects malformed bboxes with a 400 ApiRequestError', () => {
    expect(() => filterDemoPlaces(places, { bbox: '1,2,3' })).toThrowError(/invalid bbox/)
    expect(() => filterDemoPlaces(places, { bbox: '0,50,0,10' })).toThrowError(/south is greater/)
  })
})

// ── cat / attrs / q filters ──────────────────────────────────────────────────

describe('filterDemoPlaces filters', () => {
  const places = [
    place(1, { categories: [CAT_CALI], attrs: { 'calisthenics.pull_up_bars': true } }),
    place(2, { categories: [CAT_VAN], attrs: { 'vanlife.free': true } }),
    place(3, { categories: [CAT_CALI, CAT_VAN], attrs: {} }),
  ]

  it('filters by category slug', () => {
    const res = filterDemoPlaces(places, { bbox: '-180,-90,180,90', cat: 'vanlife' })
    expect(res.places.map((p) => p.id).sort()).toEqual([2, 3])
  })

  it('attrs filter requires truthy values (server JSON semantics)', () => {
    const variants = [
      place(10, { attrs: { 'calisthenics.pull_up_bars': true } }), // ✓
      place(11, { attrs: { 'calisthenics.pull_up_bars': false } }), // ✗
      place(12, { attrs: { 'calisthenics.pull_up_bars': 0 } }), // ✗
      place(13, { attrs: { 'calisthenics.pull_up_bars': '' } }), // ✗
      place(14, { attrs: { 'calisthenics.pull_up_bars': null } }), // ✗
      place(15, { attrs: {} }), // ✗ missing
      place(16, { attrs: { 'calisthenics.pull_up_bars': 3 } }), // ✓ truthy number
    ]
    const res = filterDemoPlaces(variants, {
      bbox: '-180,-90,180,90',
      attrs: ['calisthenics.pull_up_bars'],
    })
    expect(res.places.map((p) => p.id)).toEqual([10, 16])
  })

  it('validates attr filter keys when given the known set (typo → 400)', () => {
    const known = new Set(['calisthenics.pull_up_bars'])
    expect(() =>
      filterDemoPlaces(places, { bbox: '-180,-90,180,90', attrs: ['calisthenics.nope'] }, known),
    ).toThrowError(/unknown attribute filter/)
  })

  it('q matches name case-insensitively', () => {
    const named = [place(1, { name: 'Maçka Park' }), place(2, { name: 'Other' })]
    const res = filterDemoPlaces(named, { bbox: '-180,-90,180,90', q: 'MAÇKA' })
    expect(res.places.map((p) => p.id)).toEqual([1])
  })

  it('result rows are PlaceSummary-shaped (attrs stripped)', () => {
    const res = filterDemoPlaces(places, { bbox: '-180,-90,180,90' })
    expect(res.places.length).toBeGreaterThan(0)
    for (const p of res.places) expect('attrs' in p).toBe(false)
  })
})

// ── truncation + deterministic scatter ───────────────────────────────────────

describe('filterDemoPlaces sampling', () => {
  const many = Array.from({ length: 30 }, (_, i) => place(i + 1))

  it('returns a deterministic scattered sample with honest counts', () => {
    const first = filterDemoPlaces(many, { bbox: '-180,-90,180,90', limit: 10 })
    const second = filterDemoPlaces(many, { bbox: '-180,-90,180,90', limit: 10 })
    expect(first.places.map((p) => p.id)).toEqual(second.places.map((p) => p.id))
    expect(first.places).toHaveLength(10)
    expect(first.total_count).toBe(30)
    expect(first.truncated).toBe(true)

    // The sample is exactly the scatter-score ordering (contract amendment A4).
    const expected = many
      .slice()
      .sort((a, b) => scatterScore(a.id) - scatterScore(b.id) || a.id - b.id)
      .slice(0, 10)
      .map((p) => p.id)
    expect(first.places.map((p) => p.id)).toEqual(expected)
    // …and it is not just the first 10 ids (import order).
    expect(first.places.map((p) => p.id)).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('no sampling below the limit; limit caps at 1000', () => {
    const res = filterDemoPlaces(many, { bbox: '-180,-90,180,90' }) // default 500
    expect(res.places).toHaveLength(30)
    expect(res.truncated).toBe(false)
    const capped = filterDemoPlaces(many, { bbox: '-180,-90,180,90', limit: 5000 })
    expect(capped.places).toHaveLength(30)
  })
})

// ── near ─────────────────────────────────────────────────────────────────────

describe('nearDemoPlaces', () => {
  it('sorts by distance, filters by radius, rounds to 2 decimals', () => {
    const places = [
      place(1, { lat: 41.01, lng: 28.98 }), // ~1 km away
      place(2, { lat: 41.1, lng: 28.9 }), // ~13 km
      place(3, { lat: 48.8, lng: 2.3 }), // Paris — way out
    ]
    const res = nearDemoPlaces(places, 41.0, 29.0, 30)
    expect(res.map((p) => p.id)).toEqual([1, 2])
    expect(res[0].distance_km).toBeLessThan(res[1].distance_km)
    expect(res.every((p) => Math.round(p.distance_km * 100) / 100 === p.distance_km)).toBe(true)
  })

  it('applies the category filter and the 50-place cap', () => {
    const crowd = Array.from({ length: 60 }, (_, i) =>
      place(i + 1, {
        lat: 41 + (i % 8) * 0.001,
        lng: 29 + (i % 7) * 0.001,
        categories: i % 2 === 0 ? [CAT_CALI] : [CAT_VAN],
      }),
    )
    const capped = nearDemoPlaces(crowd, 41, 29, 500)
    expect(capped).toHaveLength(50)
    const vanOnly = nearDemoPlaces(crowd, 41, 29, 500, 'vanlife')
    expect(vanOnly).toHaveLength(30)
    expect(vanOnly.every((p) => p.categories.some((c) => c.slug === 'vanlife'))).toBe(true)
  })
})

// ── search ───────────────────────────────────────────────────────────────────

describe('searchDemo', () => {
  it('matches categories and places by name, 8 each, best-confirmed first', () => {
    const places = Array.from({ length: 10 }, (_, i) =>
      place(i + 1, { name: `Sunset Point ${i + 1}`, confirm_count: i }),
    )
    places.push(place(99, { name: 'Other' }))
    const res = searchDemo(CATEGORIES, places, 'sunset')
    expect(res.categories).toEqual([])
    expect(res.places).toHaveLength(8)
    expect(res.places[0].confirm_count).toBe(9) // desc by confirm_count

    const catRes = searchDemo(CATEGORIES, places, 'calisthenics')
    expect(catRes.categories.map((c) => c.slug)).toEqual(['calisthenics'])

    expect(searchDemo(CATEGORIES, places, '  ')).toEqual({ categories: [], places: [] })
  })
})
