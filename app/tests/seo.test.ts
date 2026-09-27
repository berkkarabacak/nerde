// SEO infra (CONTRACTS §6, PRODUCT_SPEC §6.16): sitemap.xml + robots.txt.
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

describe('GET /sitemap.xml', () => {
  it('lists the home page, every category, and every published place', async () => {
    const pub = insertPlace(db, { name: 'Shown Park', lat: 10, lng: 10, cats: ['calisthenics'] })
    insertPlace(db, { name: 'Hidden Park', lat: 11, lng: 11, status: 'removed' })
    const res = await api(server.base, 'GET', '/sitemap.xml')
    expect(res.status).toBe(200)
    expect(res.contentType).toContain('application/xml')
    expect(res.text).toContain('<loc>https://nerde.com/</loc>')
    for (const slug of ['calisthenics', 'arm-wrestling', 'vanlife', 'sunset-spots']) {
      expect(res.text).toContain(`<loc>https://nerde.com/c/${slug}</loc>`)
    }
    expect(res.text).toContain(`<loc>https://nerde.com/place/${pub.slug}</loc>`)
    expect(res.text).toContain('<lastmod>') // place URLs carry lastmod
    expect(res.text).not.toContain('Hidden Park')
    expect(res.text).not.toContain('hidden-park')
  })

  it('XML-escapes hostile slugs/names (no XML injection)', async () => {
    // Slugs are kebab-safe by construction, but the escaping helper is defense
    // in depth — verify the document stays well-formed with weird data around.
    insertPlace(db, { name: 'A & B <Park>', lat: 10, lng: 10 })
    const res = await api(server.base, 'GET', '/sitemap.xml')
    expect(res.status).toBe(200)
    expect(res.text).not.toContain('<Park>')
  })

  it('excludes thin places: generic fallback name + no photos + empty description (B1b)', async () => {
    // Generic fallback names used by the OSM importer (category name or known
    // OSM-tag label) with no photo and no description → not submitted.
    const generic = insertPlace(db, { name: 'Drinking water', lat: 10, lng: 10, cats: ['calisthenics'] })
    const catName = insertPlace(db, { name: 'calisthenics parks', lat: 11, lng: 11, cats: ['calisthenics'] })
    const named = insertPlace(db, { name: 'Maçka Calisthenics Park', lat: 12, lng: 12, cats: ['calisthenics'] })
    const res = await api(server.base, 'GET', '/sitemap.xml')
    expect(res.status).toBe(200)
    expect(res.text).not.toContain(`/place/${generic.slug}`)
    expect(res.text).not.toContain(`/place/${catName.slug}`)
    expect(res.text).toContain(`<loc>https://nerde.com/place/${named.slug}</loc>`)
  })

  it('a generic-named place WITH a description or a photo is NOT thin → stays listed', async () => {
    const withDesc = insertPlace(db, {
      name: 'Picnic table',
      lat: 10,
      lng: 10,
      description: 'Shaded table next to the fountain, usually free at noon.',
    })
    const withPhoto = insertPlace(db, { name: 'Bench', lat: 11, lng: 11 })
    db.prepare('INSERT INTO photos (place_id, url) VALUES (?, ?)').run(withPhoto.id, '/uploads/test.jpg')
    const res = await api(server.base, 'GET', '/sitemap.xml')
    expect(res.text).toContain(`/place/${withDesc.slug}`)
    expect(res.text).toContain(`/place/${withPhoto.slug}`)
  })

  it('P1-11a coupling: composed "<Base> [(attrs)] — <City>" names stay thin-excluded', async () => {
    // enrich-names.ts rewrites generic names to these suffixed forms — the
    // sitemap must still treat them as thin stubs (server/genericNames.ts is
    // the shared single source of truth).
    const suffixed = insertPlace(db, { name: 'Drinking water — Istanbul', lat: 10, lng: 10 })
    const withAttrs = insertPlace(db, { name: 'Calisthenics park (pull-up bars, rings) — Berlin', lat: 11, lng: 11 })
    const catBase = insertPlace(db, { name: 'Calisthenics Parks — Berlin', lat: 12, lng: 12, cats: ['calisthenics'] })
    const realSuffixed = insertPlace(db, { name: 'Maçka Calisthenics Park — Istanbul', lat: 13, lng: 13 })
    const res = await api(server.base, 'GET', '/sitemap.xml')
    expect(res.status).toBe(200)
    expect(res.text).not.toContain(`/place/${suffixed.slug}`)
    expect(res.text).not.toContain(`/place/${withAttrs.slug}`)
    expect(res.text).not.toContain(`/place/${catBase.slug}`)
    // …but a REAL name that merely contains an em dash is not collateral damage.
    expect(res.text).toContain(`<loc>https://nerde.com/place/${realSuffixed.slug}</loc>`)
  })
})

describe('GET /robots.txt', () => {
  it('allows crawling, disallows private routes, references the sitemap', async () => {
    const res = await api(server.base, 'GET', '/robots.txt')
    expect(res.status).toBe(200)
    expect(res.contentType).toContain('text/plain')
    expect(res.text).toContain('User-agent: *')
    expect(res.text).toContain('Allow: /')
    expect(res.text).toContain('Disallow: /admin')
    expect(res.text).toContain('Disallow: /add')
    expect(res.text).toContain('Disallow: /saved')
    expect(res.text).toContain('Sitemap: https://nerde.com/sitemap.xml')
  })

  it('POST to sitemap/robots → 405 (SEO endpoints are GET-only)', async () => {
    const res = await api(server.base, 'POST', '/sitemap.xml', { body: {} })
    expect(res.status).toBe(405)
  })
})
