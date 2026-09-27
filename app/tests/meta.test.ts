// Server-side meta injection tests (SEO_STRATEGY §2.3/§3/§4, MVP_BACKLOG P1-05+).
// Covers renderMetaForPath() for home/category/place + the injectMeta() shell
// rewriter. The serve.ts-level integration (real HTTP server + dist shell)
// lives in serve-meta.test.ts.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { cleanupTmp, freshDb, insertPlace } from './helpers.ts'
import { injectMeta, renderMetaForPath } from '../server/meta.ts'
import type { RouteMeta } from '../server/meta.ts'

const BASE = 'https://meta.test'

let db: DatabaseSync

beforeEach(() => {
  db = freshDb()
  process.env.NERDE_BASE_URL = BASE
})
afterAll(() => {
  delete process.env.NERDE_BASE_URL
  cleanupTmp()
})

describe('renderMetaForPath — home /', () => {
  it('returns the §4 home title/description, absolute canonical and WebSite JSON-LD', () => {
    const meta = renderMetaForPath('/')
    expect(meta).not.toBeNull()
    expect(meta!.title).toBe('Nerde — Specialized Maps for Specific Places')
    expect(meta!.title.length).toBeLessThanOrEqual(60)
    expect(meta!.description.length).toBeGreaterThanOrEqual(140)
    expect(meta!.description.length).toBeLessThanOrEqual(165)
    expect(meta!.description).toContain('Where can I find X?')
    expect(meta!.canonical).toBe(`${BASE}/`)
    expect(meta!.ogType).toBe('website')
    const ld = meta!.jsonLd[0]
    expect(ld['@type']).toBe('WebSite')
    expect(ld.url).toBe(`${BASE}/`)
    expect((ld.potentialAction as Record<string, unknown>)['@type']).toBe('SearchAction')
  })

  it('returns null for non-indexable routes (client-side meta owns those)', () => {
    for (const p of ['/login', '/saved', '/add', '/admin', '/u/someone', '/c/calisthenics/extra']) {
      expect(renderMetaForPath(p)).toBeNull()
    }
  })
})

describe('renderMetaForPath — /c/:slug', () => {
  it('builds title/description/canonical/ItemList from the DB', () => {
    insertPlace(db, { name: 'Alpha Park', lat: 41.04, lng: 28.99, cats: ['calisthenics'], city: 'Istanbul' })
    insertPlace(db, { name: 'Beta Park', lat: 52.52, lng: 13.4, cats: ['calisthenics'], city: 'Berlin' })
    insertPlace(db, { name: 'Gamma Park', lat: 41.05, lng: 29.0, cats: ['calisthenics'], city: 'Istanbul' })
    insertPlace(db, { name: 'Gone Park', lat: 1, lng: 1, cats: ['calisthenics'], status: 'removed' })

    const meta = renderMetaForPath('/c/calisthenics')
    expect(meta).not.toBeNull()
    expect(meta!.title).toBe('Calisthenics Parks Near You — Nerde')
    expect(meta!.canonical).toBe(`${BASE}/c/calisthenics`)
    // §4 description template: count, filter labels, trust line, top cities.
    expect(meta!.description).toContain('Find 3 calisthenics parks worldwide.')
    expect(meta!.description).toContain('Filter by pull up bars, parallel bars, lighting.')
    expect(meta!.description).toContain('Community-verified, free, updated daily.')
    expect(meta!.description).toContain('Top cities: Istanbul, Berlin.')
    expect(meta!.description.length).toBeLessThanOrEqual(165)

    const ld = meta!.jsonLd[0]
    expect(ld['@type']).toBe('ItemList')
    expect(ld.numberOfItems).toBe(3) // removed place excluded
    const items = ld.itemListElement as Array<Record<string, any>>
    expect(items).toHaveLength(3)
    expect(items[0].position).toBe(1)
    expect(items[0].item['@type']).toBe('Place')
    expect(items[0].item.geo['@type']).toBe('GeoCoordinates')
    expect(items[0].item.url).toMatch(new RegExp(`^${BASE}/place/`))
  })

  it('omits "Top cities" below 3 places and uses the long-name title variant when needed', () => {
    insertPlace(db, { name: 'Solo Park', lat: 1, lng: 1, cats: ['calisthenics'], city: 'Istanbul' })
    const meta = renderMetaForPath('/c/calisthenics')
    expect(meta!.description).toContain('Find 1 calisthenics parks worldwide.')
    expect(meta!.description).not.toContain('Top cities')

    db.prepare(
      `INSERT INTO categories (slug, name, icon, color, grp, sort)
       VALUES ('very-long', 'Extremely Long Experimental Category Name', '📍', '#2563eb', 'outdoor', 99)`,
    ).run()
    const longMeta = renderMetaForPath('/c/very-long')
    expect(longMeta!.title).toBe('Extremely Long Experimental Category Name — Nerde')
    expect(longMeta!.title.length).toBeLessThanOrEqual(65)
  })

  it('returns null for an unknown category slug', () => {
    expect(renderMetaForPath('/c/nope')).toBeNull()
  })
})

describe('renderMetaForPath — /place/:slug', () => {
  it('builds the §4 place description + §3.3 Place JSON-LD with GeoCoordinates', () => {
    const place = insertPlace(db, {
      name: 'Maçka Calisthenics Park',
      lat: 41.047,
      lng: 28.992,
      cats: ['calisthenics'],
      attrs: {
        'calisthenics.pull_up_bars': true,
        'calisthenics.free': true,
        'calisthenics.access_24_7': true, // raw attrs drive openingHours even without a def
      },
      description: 'Park with pull-up and dip bars near the Bosphorus.',
      city: 'Istanbul',
      country: 'Turkey',
      country_code: 'TR',
    })
    db.prepare('INSERT INTO photos (place_id, url) VALUES (?, ?)').run(place.id, '/uploads/macka.jpg')
    db.prepare(
      `UPDATE places SET confirm_count = 8, last_verified_at = datetime('now', '-12 days') WHERE id = ?`,
    ).run(place.id)

    const meta = renderMetaForPath(`/place/${place.slug}`)
    expect(meta).not.toBeNull()
    expect(meta!.title).toBe('Maçka Calisthenics Park, Istanbul — Nerde')
    expect(meta!.title.length).toBeLessThanOrEqual(60)
    expect(meta!.description).toBe(
      'Maçka Calisthenics Park — Calisthenics Parks in Istanbul, Turkey. ' +
        'Park with pull-up and dip bars near the Bosphorus. ' +
        'Verified 12 days ago · 8 confirmations.',
    )
    expect(meta!.description.length).toBeGreaterThanOrEqual(140)
    expect(meta!.description.length).toBeLessThanOrEqual(160)
    expect(meta!.canonical).toBe(`${BASE}/place/${place.slug}`)
    expect(meta!.ogType).toBe('place')
    expect(meta!.ogImage).toBe(`${BASE}/uploads/macka.jpg`)

    const ld = meta!.jsonLd[0]
    expect(ld['@type']).toBe('Place')
    expect(ld.name).toBe('Maçka Calisthenics Park')
    expect(ld.url).toBe(`${BASE}/place/${place.slug}`)
    expect(ld.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 41.047, longitude: 28.992 })
    expect(ld.image).toEqual([`${BASE}/uploads/macka.jpg`])
    expect(ld.address).toEqual({
      '@type': 'PostalAddress',
      addressLocality: 'Istanbul',
      addressCountry: 'TR',
    })
    expect(ld.openingHours).toBe('Mo-Su 00:00-24:00')
    expect(ld.isAccessibleForFree).toBe(true)
    const props = ld.additionalProperty as Array<Record<string, unknown>>
    expect(props).toContainEqual({ '@type': 'PropertyValue', name: 'pull up bars', value: true })
    expect(props).toContainEqual({ '@type': 'PropertyValue', name: 'free', value: true })
  })

  it('falls back to country-only / name-only titles and omits absent fields honestly', () => {
    const noCity = insertPlace(db, {
      name: 'Treptower Park Workout Area',
      lat: 52.49,
      lng: 13.47,
      cats: ['calisthenics'],
      country: 'Germany',
    })
    const meta = renderMetaForPath(`/place/${noCity.slug}`)
    expect(meta!.title).toBe('Treptower Park Workout Area, Germany — Nerde')
    // Unverified place → no "Verified …" sentence; no description → no excerpt;
    // no photo → ogImage null (injectMeta falls back to the branded default);
    // no free/access_24_7 attrs → those JSON-LD keys stay absent (§3.3 rules).
    expect(meta!.description).not.toContain('Verified')
    expect(meta!.ogImage).toBeNull()
    const ld = meta!.jsonLd[0]
    expect(ld).not.toHaveProperty('image')
    expect(ld).not.toHaveProperty('openingHours')
    expect(ld).not.toHaveProperty('isAccessibleForFree')
    expect(ld).not.toHaveProperty('description')

    const bare = insertPlace(db, { name: 'Nameless Ridge Spot', lat: 1, lng: 1, cats: ['vanlife'] })
    expect(renderMetaForPath(`/place/${bare.slug}`)!.title).toBe('Nameless Ridge Spot — Nerde')
  })

  it('enforces the title/description budgets on long content', () => {
    const long = insertPlace(db, {
      name: 'A Very Long Place Name That Keeps Going And Going And Going Forever',
      lat: 1,
      lng: 1,
      cats: ['calisthenics'],
      description: 'word '.repeat(100),
      city: 'Constantinople-the-very-long-city-name',
      country: 'Turkey',
    })
    const meta = renderMetaForPath(`/place/${long.slug}`)!
    expect(meta.title.length).toBeLessThanOrEqual(65)
    expect(meta.description.length).toBeLessThanOrEqual(165)
    expect(meta.description).not.toContain('…') // no ellipsis stuffing (§4)
  })

  it('returns null for unknown and non-published places (404 flow stays in charge)', () => {
    expect(renderMetaForPath('/place/does-not-exist')).toBeNull()
    const pending = insertPlace(db, { name: 'Pending Park', lat: 1, lng: 1, status: 'pending' })
    expect(renderMetaForPath(`/place/${pending.slug}`)).toBeNull()
    const removed = insertPlace(db, { name: 'Removed Park', lat: 1, lng: 1, status: 'removed' })
    expect(renderMetaForPath(`/place/${removed.slug}`)).toBeNull()
  })
})

describe('injectMeta — HTML shell rewriting', () => {
  const SHELL = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta',
    '      name="description"',
    '      content="OLD DESC"',
    '    />',
    '    <title>OLD TITLE</title>',
    '    <script type="module" crossorigin src="/assets/index-TEST.js"></script>',
    '  </head>',
    '  <body><div id="root"></div></body>',
    '</html>',
  ].join('\n')

  it('replaces title/description, injects og/twitter/canonical/JSON-LD, keeps the bundle', () => {
    const meta: RouteMeta = {
      title: 'T <b> & "q"',
      description: 'Desc & "quoted" <x>',
      canonical: `${BASE}/place/test-x`,
      ogType: 'place',
      ogImage: null,
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'Place', name: 'N </script><script>alert(1)</script>' }],
    }
    const out = injectMeta(SHELL, meta)

    expect(out).not.toContain('OLD TITLE')
    expect(out).not.toContain('OLD DESC')
    expect(out).toContain('<title>T &lt;b&gt; &amp; "q"</title>') // text node: quotes stay literal
    expect(out).toContain('<meta name="description" content="Desc &amp; &quot;quoted&quot; &lt;x&gt;" />')
    expect(out).toContain(`<link rel="canonical" href="${BASE}/place/test-x" />`)
    expect(out).toContain(`<meta property="og:title" content="T &lt;b&gt; &amp; &quot;q&quot;" />`)
    expect(out).toContain(`<meta property="og:type" content="place" />`)
    expect(out).toContain(`<meta property="og:image" content="${BASE}/og-default.png" />`) // fallback
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image" />')

    // JSON-LD present and XSS-safe: '<' escaped as < inside the JSON.
    expect(out).toContain('<script type="application/ld+json">')
    expect(out).not.toContain('</script><script>alert(1)</script>')
    expect(out).toContain('\\u003c/script>')

    // The SPA bundle reference and app root survive untouched.
    expect(out).toContain('<script type="module" crossorigin src="/assets/index-TEST.js"></script>')
    expect(out).toContain('<div id="root"></div>')
  })
})
