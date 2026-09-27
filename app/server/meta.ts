// Server-side per-route meta for the HTML shell — the SEO_STRATEGY §2.3
// "middleware HTML-shell meta injection" upgrade (MVP_BACKLOG P1-05+).
//
// renderMetaForPath() computes {title, description, canonical, OG, JSON-LD}
// for the indexable routes (/, /c/:slug, /place/:slug) straight from the DB;
// injectMeta() rewrites the built index.html shell with those values. Both the
// production server (server/serve.ts) and the dev vite plugin
// (vite.config.ts transformIndexHtml) use this module, so crawlers and link
// unfurlers (WhatsApp/Telegram/Slack — they never run JS) always see correct
// metadata. The client (src/lib/seo.ts) re-sets the same values on SPA
// navigations — server injection is the crawler baseline, the client keeps
// in-app navigations fresh.
//
// Templates and budgets follow SEO_STRATEGY §4: title ≤60 (hard stop 65,
// place names truncated at 40), description 140–160 (hard stop 165), JSON-LD
// per §3 (never aggregateRating/review — Nerde has no ratings).
import { baseUrl } from './config.ts'
import { getDb } from './db.ts'
import { getAttrDefs } from './placeData.ts'
import type { CategoryRow, PlaceRow } from './placeData.ts'

const SITE_NAME = 'Nerde'
const TITLE_HARD_MAX = 65
const DESC_HARD_MAX = 165

const HOME_TITLE = 'Nerde — Specialized Maps for Specific Places'
const HOME_DESCRIPTION =
  'Where can I find X? Nerde maps the niche places conventional maps miss — calisthenics parks, vanlife spots, arm wrestling clubs, public showers and more.'

export interface RouteMeta {
  title: string
  description: string
  /** Absolute canonical URL. */
  canonical: string
  ogType: 'website' | 'place'
  /** Absolute image URL; null → injectMeta falls back to the branded default. */
  ogImage: string | null
  jsonLd: Array<Record<string, unknown>>
}

/** Routes that get server-injected meta; everything else serves the raw shell. */
export function renderMetaForPath(pathname: string): RouteMeta | null {
  if (pathname === '/') return homeMeta()
  const cat = /^\/c\/([a-z0-9-]{2,60})$/.exec(pathname)
  if (cat) return categoryMeta(cat[1])
  const place = /^\/place\/([a-z0-9-]{2,80})$/.exec(pathname)
  if (place) return placeMeta(place[1])
  return null
}

// ── Budget helpers (mirrors src/lib/seo.ts clamping; duplicated here so the
// server module stays self-contained) ────────────────────────────────────────

export function clampTitle(title: string): string {
  if (title.length <= TITLE_HARD_MAX) return title
  const cut = title.slice(0, TITLE_HARD_MAX)
  const boundary = cut.lastIndexOf(' ')
  return (boundary > 40 ? cut.slice(0, boundary) : cut).trim()
}

export function clampDescription(description: string): string {
  if (description.length <= DESC_HARD_MAX) return description
  const cut = description.slice(0, DESC_HARD_MAX)
  const boundary = cut.lastIndexOf(' ')
  return (boundary > 100 ? cut.slice(0, boundary) : cut).trim()
}

/** First `max` chars of a text, cut at a word boundary, whitespace-collapsed. */
function firstWords(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const boundary = cut.lastIndexOf(' ')
  return (boundary > max / 2 ? cut.slice(0, boundary) : cut).trim()
}

/** "Verified {x ago}" phrasing for meta descriptions (UTC datetime strings). */
function verifiedAgo(sqlDatetime: string): string {
  const then = new Date(`${sqlDatetime.replace(' ', 'T')}Z`).getTime()
  if (!Number.isFinite(then)) return 'recently'
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(days / 365)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) return pathOrUrl
  return `${baseUrl()}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`
}

// ── Route builders ───────────────────────────────────────────────────────────

function homeMeta(): RouteMeta {
  const base = baseUrl()
  return {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    canonical: `${base}/`,
    ogType: 'website',
    ogImage: null,
    // SEO_STRATEGY §3.1 — WebSite + SearchAction.
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Nerde',
        alternateName: 'Nerde.com',
        url: `${base}/`,
        description:
          'Specialized maps for highly specific categories of physical places — calisthenics parks, vanlife spots, arm wrestling clubs and more.',
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${base}/?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  }
}

interface TopPlaceRow {
  name: string
  slug: string
  lat: number
  lng: number
  photo_url: string | null
}

function categoryMeta(slug: string): RouteMeta | null {
  const db = getDb()
  const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug) as
    | CategoryRow
    | undefined
  if (!cat) return null

  const count = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM places p
         JOIN place_categories pc ON pc.place_id = p.id
         WHERE pc.category_id = ? AND p.status = 'published'`,
      )
      .get(cat.id) as { c: number }
  ).c
  const filterable = db
    .prepare(
      'SELECT label FROM category_attributes WHERE category_id = ? AND filterable = 1 ORDER BY sort, id LIMIT 3',
    )
    .all(cat.id) as Array<{ label: string }>
  const cities = db
    .prepare(
      `SELECT p.city, COUNT(*) AS c FROM places p
       JOIN place_categories pc ON pc.place_id = p.id
       WHERE pc.category_id = ? AND p.status = 'published' AND p.city <> ''
       GROUP BY p.city ORDER BY c DESC, p.city LIMIT 3`,
    )
    .all(cat.id) as Array<{ city: string; c: number }>
  // Top 50 by confirm_count — the same set as the "Most verified places" HTML
  // block (SEO_STRATEGY §3.2 / §5).
  const topPlaces = db
    .prepare(
      `SELECT p.name, p.slug, p.lat, p.lng,
              (SELECT ph.url FROM photos ph WHERE ph.place_id = p.id ORDER BY ph.id LIMIT 1) AS photo_url
       FROM places p JOIN place_categories pc ON pc.place_id = p.id
       WHERE pc.category_id = ? AND p.status = 'published'
       ORDER BY p.confirm_count DESC, p.id LIMIT 50`,
    )
    .all(cat.id) as TopPlaceRow[]

  const base = baseUrl()
  const canonical = `${base}/c/${cat.slug}`

  // §4: "{Category Name} Near You — Nerde"; long-name variant when >48 chars.
  const fullTitle = `${cat.name} Near You — ${SITE_NAME}`
  const title = clampTitle(fullTitle.length > 48 ? `${cat.name} — ${SITE_NAME}` : fullTitle)

  const sentences = [`Find ${count} ${cat.name.toLowerCase()} worldwide.`]
  if (filterable.length > 0) {
    sentences.push(`Filter by ${filterable.map((f) => f.label.toLowerCase()).join(', ')}.`)
  }
  sentences.push('Community-verified, free, updated daily.')
  const topCities = count >= 3 && cities.length > 0 ? `Top cities: ${cities.map((c) => c.city).join(', ')}.` : null
  if (topCities) sentences.push(topCities)
  let description = sentences.join(' ')
  if (description.length > DESC_HARD_MAX && topCities) {
    description = sentences.slice(0, -1).join(' ') // drop "Top cities" first
  }
  description = clampDescription(description)

  const firstPhoto = topPlaces.find((p) => p.photo_url)?.photo_url ?? null

  return {
    title,
    description,
    canonical,
    ogType: 'website',
    ogImage: firstPhoto ? absoluteUrl(firstPhoto) : null,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: cat.name,
        url: canonical,
        numberOfItems: count,
        itemListElement: topPlaces.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Place',
            name: p.name,
            url: `${base}/place/${p.slug}`,
            geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng },
          },
        })),
      },
    ],
  }
}

function placeMeta(slug: string): RouteMeta | null {
  const db = getDb()
  // Published only (SEO_STRATEGY §6.4): pending/removed places must not carry
  // crawler meta — null falls through to the plain shell / 404 flow.
  const p = db
    .prepare(`SELECT * FROM places WHERE slug = ? AND status = 'published'`)
    .get(slug) as PlaceRow | undefined
  if (!p) return null

  const cats = db
    .prepare(
      `SELECT c.* FROM categories c
       JOIN place_categories pc ON pc.category_id = c.id
       WHERE pc.place_id = ? ORDER BY c.grp, c.sort, c.id`,
    )
    .all(p.id) as CategoryRow[]
  const photos = db
    .prepare('SELECT url FROM photos WHERE place_id = ? ORDER BY id')
    .all(p.id) as Array<{ url: string }>
  const attrs = JSON.parse(p.attrs || '{}') as Record<string, unknown>

  const base = baseUrl()
  const canonical = `${base}/place/${p.slug}`

  // §4: place names longer than 40 chars are truncated at a word boundary
  // before the title template is applied.
  const shortName = firstWords(p.name, 40)
  const title = clampTitle(
    p.city
      ? `${shortName}, ${p.city} — ${SITE_NAME}`
      : p.country
        ? `${shortName}, ${p.country} — ${SITE_NAME}`
        : `${shortName} — ${SITE_NAME}`,
  )

  const catNames = cats.map((c) => c.name).join(', ')
  const loc = p.city && p.country ? ` in ${p.city}, ${p.country}` : p.city ? ` in ${p.city}` : p.country ? ` in ${p.country}` : ''
  const sentences = [`${p.name} — ${catNames}${loc}.`]
  const excerpt = p.description.trim() ? firstWords(p.description, 70) : null
  if (excerpt) sentences.push(/[.!?…]$/.test(excerpt) ? excerpt : `${excerpt}.`)
  if (p.last_verified_at) {
    sentences.push(
      `Verified ${verifiedAgo(p.last_verified_at)} · ${p.confirm_count} confirmation${p.confirm_count === 1 ? '' : 's'}.`,
    )
  }
  let description = sentences.join(' ')
  if (description.length > DESC_HARD_MAX && excerpt) {
    // Over budget: drop the free-text excerpt before hard-clamping.
    sentences.splice(1, 1)
    description = sentences.join(' ')
  }
  description = clampDescription(description)

  // JSON-LD per §3.3 — field rules: image omitted when no photos;
  // openingHours only from access_24_7; isAccessibleForFree only from free;
  // additionalProperty carries resolved attributes (labels, not raw keys).
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: p.name,
    url: canonical,
  }
  if (p.description.trim()) ld.description = p.description.trim().slice(0, 300)
  if (photos.length > 0) ld.image = photos.map((ph) => absoluteUrl(ph.url))
  const address: Record<string, unknown> = { '@type': 'PostalAddress' }
  if (p.address) address.streetAddress = p.address
  if (p.city) address.addressLocality = p.city
  if (p.region) address.addressRegion = p.region
  if (p.country_code) address.addressCountry = p.country_code
  if (Object.keys(address).length > 1) ld.address = address
  ld.geo = { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng }
  const hasAttr = (key: string): boolean =>
    Object.entries(attrs).some(([k, v]) => k.endsWith(`.${key}`) && v === true)
  if (hasAttr('access_24_7')) ld.openingHours = 'Mo-Su 00:00-24:00'
  if (hasAttr('free')) ld.isAccessibleForFree = true
  const properties: Array<Record<string, unknown>> = []
  for (const cat of cats) {
    for (const def of getAttrDefs(cat.id)) {
      const fullKey = `${cat.slug}.${def.key}`
      if (Object.prototype.hasOwnProperty.call(attrs, fullKey)) {
        properties.push({ '@type': 'PropertyValue', name: def.label, value: attrs[fullKey] ?? null })
      }
    }
  }
  if (properties.length > 0) ld.additionalProperty = properties

  return {
    title,
    description,
    canonical,
    ogType: 'place',
    ogImage: photos.length > 0 ? absoluteUrl(photos[0].url) : null,
    jsonLd: [ld],
  }
}

// ── Shell injection ──────────────────────────────────────────────────────────

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;')
}

/**
 * Rewrite the built index.html shell with route meta: replace <title> and the
 * description meta in place, inject canonical + Open Graph + Twitter + JSON-LD
 * before </head>. The JS bundle and the rest of the shell stay untouched, so
 * the SPA hydrates exactly as before (and re-sets the same tags client-side on
 * navigation — SEO_STRATEGY §2.3 last sentence).
 */
export function injectMeta(html: string, meta: RouteMeta): string {
  if (!html.includes('</head>')) return html
  const title = clampTitle(meta.title)
  const description = clampDescription(meta.description)
  const ogImage = meta.ogImage ?? `${baseUrl()}/og-default.png`

  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtmlText(title)}</title>`)
  const descTag = `<meta name="description" content="${escapeAttr(description)}" />`
  if (/<meta[^>]*name="description"[^>]*>/.test(out)) {
    out = out.replace(/<meta[^>]*name="description"[^>]*>/, descTag)
  } else {
    out = out.replace('</head>', `    ${descTag}\n  </head>`)
  }

  const tags = [
    `<link rel="canonical" href="${escapeAttr(meta.canonical)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:url" content="${escapeAttr(meta.canonical)}" />`,
    `<meta property="og:type" content="${meta.ogType}" />`,
    `<meta property="og:image" content="${escapeAttr(ogImage)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
  ]
  for (const block of meta.jsonLd) {
    // Escape '<' so a place name can never break out of the script element.
    const safeJson = JSON.stringify(block).replace(/</g, '\\u003c')
    tags.push(`<script type="application/ld+json">${safeJson}</script>`)
  }
  return out.replace('</head>', `${tags.map((t) => `    ${t}`).join('\n')}\n  </head>`)
}
