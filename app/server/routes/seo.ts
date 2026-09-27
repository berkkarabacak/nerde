// GET /sitemap.xml + GET /robots.txt (CONTRACTS §6 SEO infra; DATABASE.md §5.5).
import { getDb } from '../db.ts'
import { GENERIC_FALLBACK_NAME_RE, isGenericImportName } from '../genericNames.ts'
import type { Ctx } from '../http.ts'
import { xmlEscape } from '../validate.ts'

// Canonical origin for absolute URLs. Overridable for staging without a code
// change; the production value is the product domain.
const BASE_URL = (process.env.NERDE_BASE_URL ?? 'https://nerde.com').replace(/\/$/, '')

/**
 * THIN-CONTENT HEURISTIC (contract amendment, CRITICAL_REVIEW B1b — the
 * sitemap must not mass-submit near-duplicate stub pages):
 * a place is THIN when it has NO photos AND an empty description AND a generic
 * fallback name. A name is generic when it equals any category name
 * (case-insensitive — the importer's fallbackName uses exactly these) or
 * matches the known OSM-tag fallback labels — INCLUDING the composed
 * "<Base> [(attrs)] — <City>" variants produced by scripts/enrich-names.ts
 * (P1-11a), e.g. "Drinking water — Istanbul". The shared implementation lives
 * in server/genericNames.ts (single source of truth; re-exported here because
 * A6 documents GENERIC_FALLBACK_NAME_RE as part of this module). Thin places
 * stay fully reachable on the map and via direct URL — they are just not
 * submitted to crawlers.
 */
export { GENERIC_FALLBACK_NAME_RE }

interface PlaceSitemapRow {
  slug: string
  updated_at: string
  name: string
  description: string
  has_photo: number
}

export async function sitemap(ctx: Ctx): Promise<void> {
  const db = getDb()
  const categories = db
    .prepare('SELECT slug, name FROM categories ORDER BY sort, id')
    .all() as Array<{ slug: string; name: string }>
  const categoryNames = new Set(categories.map((c) => c.name.toLowerCase()))
  const places = db
    .prepare(
      `SELECT p.slug, p.updated_at, p.name, p.description,
              EXISTS(SELECT 1 FROM photos ph WHERE ph.place_id = p.id) AS has_photo
       FROM places p WHERE p.status = 'published' ORDER BY p.id`,
    )
    .all() as PlaceSitemapRow[]

  const isThin = (p: PlaceSitemapRow): boolean =>
    p.has_photo === 0 && p.description.trim() === '' && isGenericImportName(p.name, categoryNames)

  const urls: string[] = []
  // Static routes from code (DATABASE.md §5.5); categories; published places.
  urls.push(`  <url><loc>${xmlEscape(BASE_URL)}/</loc></url>`)
  for (const c of categories) {
    urls.push(`  <url><loc>${xmlEscape(BASE_URL)}/c/${xmlEscape(c.slug)}</loc></url>`)
  }
  for (const p of places) {
    if (isThin(p)) continue // thin stubs are excluded from the sitemap (B1b)
    // updated_at 'YYYY-MM-DD HH:MM:SS' → lastmod 'YYYY-MM-DD'
    const lastmod = p.updated_at.slice(0, 10)
    urls.push(
      `  <url><loc>${xmlEscape(BASE_URL)}/place/${xmlEscape(p.slug)}</loc><lastmod>${xmlEscape(lastmod)}</lastmod></url>`,
    )
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
  ctx.res.statusCode = 200
  ctx.res.setHeader('content-type', 'application/xml; charset=utf-8')
  ctx.res.end(xml)
}

export async function robots(ctx: Ctx): Promise<void> {
  const text = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /add',
    'Disallow: /saved',
    'Disallow: /admin',
    'Disallow: /login',
    '',
    `Sitemap: ${BASE_URL}/sitemap.xml`,
    '',
  ].join('\n')
  ctx.res.statusCode = 200
  ctx.res.setHeader('content-type', 'text/plain; charset=utf-8')
  ctx.res.end(text)
}
