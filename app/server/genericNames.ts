// Generic import-name detection — SINGLE SOURCE OF TRUTH shared by:
//   • server/routes/seo.ts      (A6 thin-place sitemap exclusion, B1b)
//   • scripts/enrich-names.ts   (P1-11a: which names get composed with city)
//   • scripts/enrich-photos.ts  (P1-11b: which names count as "real")
//
// CRITICAL COUPLING: enrich-names.ts rewrites generic names to the composed
// form "<Base> [(attr, attr)] — <City>" (e.g. "Drinking water — Istanbul").
// The sitemap heuristic MUST keep treating those composed variants as thin —
// that is why both the bare and the suffixed forms match here. If the compose
// format ever changes, update this module and the seo.test.ts suffixed-variant
// coverage together.

/**
 * Base labels the OSM importer uses when an element has no name tag
 * (scripts/import-osm.ts `fallbackName` values), plus `bench` which predates
 * the importer. All lowercase; matching is case-insensitive.
 */
const GENERIC_FALLBACK_BASES = [
  'drinking water',
  'picnic table',
  'picnic site',
  'bbq area',
  'bench',
  'viewpoint',
  'fitness station',
  'calisthenics park',
  'climbing spot',
  'skatepark',
  'parkour spot',
  'basketball court',
  'table tennis table',
  'public shower',
  'swimming area',
  'bathing place',
  'beach swim spot',
  'motorhome stopover',
  'caravan site',
  'sanitary dump station',
  'water point',
]

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Matches a generic fallback base, optionally followed by the enrich-names
 * decorations: an attribute parenthetical "(pull-up bars, rings)" and/or the
 * city suffix " — Istanbul" (em/en dash or hyphen). Examples that match:
 *   "Drinking water"
 *   "Drinking water — Istanbul"
 *   "Calisthenics park (pull-up bars, rings) — Berlin"
 */
export const GENERIC_FALLBACK_NAME_RE = new RegExp(
  `^(${GENERIC_FALLBACK_BASES.map(escapeRe).join('|')})(\\s*\\([^)]*\\))?(\\s+[—–-]\\s+.+)?$`,
  'i',
)

const CITY_SUFFIX_RE = /\s+[—–-]\s+.+$/
const ATTR_PAREN_RE = /\s*\([^)]*\)$/

/**
 * Strip the enrich-names decorations from a composed name, returning the base:
 *   "Calisthenics park (pull-up bars, rings) — Berlin" → "Calisthenics park"
 *   "Drinking water — Istanbul"                        → "Drinking water"
 * Names without decorations are returned trimmed but otherwise unchanged.
 */
export function genericNameBase(name: string): string {
  let base = name.trim()
  base = base.replace(CITY_SUFFIX_RE, '')
  base = base.replace(ATTR_PAREN_RE, '')
  return base.trim()
}

/**
 * Is `name` a generic import name (bare or composed-with-city)?
 * True when the name (or its stripped base) equals a category name
 * case-insensitively — the importer's fallback labels reuse category naming —
 * or matches GENERIC_FALLBACK_NAME_RE. `categoryNamesLower` is the lowercased
 * set of categories.name values.
 */
export function isGenericImportName(name: string, categoryNamesLower: ReadonlySet<string>): boolean {
  const trimmed = name.trim()
  if (trimmed === '') return false
  if (GENERIC_FALLBACK_NAME_RE.test(trimmed)) return true
  const lower = trimmed.toLowerCase()
  if (categoryNamesLower.has(lower)) return true
  const base = genericNameBase(trimmed).toLowerCase()
  return base !== lower && categoryNamesLower.has(base)
}
