// P1-11a name composition (CRITICAL_REVIEW B1b): unit tests for the pure
// helpers in scripts/enrich-names.ts + the shared generic-name heuristic in
// server/genericNames.ts. CRITICAL COUPLING: the same heuristic drives the
// sitemap thin-place exclusion (server/routes/seo.ts) — the composed
// "<Base> [(attrs)] — <City>" variants MUST keep matching as generic, covered
// here and end-to-end in seo.test.ts.
import { describe, expect, it } from 'vitest'
import { ATTR_HIGHLIGHTS, composeInformativeName } from '../scripts/enrich-names.ts'
import type { EnrichCandidate } from '../scripts/enrich-names.ts'
import { GENERIC_FALLBACK_NAME_RE, genericNameBase, isGenericImportName } from '../server/genericNames.ts'

// Mirrors the seeded category names (lowercased) for the relevant categories.
const CATEGORY_NAMES = new Set(
  ['Calisthenics Parks', 'Outdoor Gyms', 'Drinking Water', 'BBQ & Picnic Areas', 'Viewpoints', 'Vanlife Spots'].map(
    (n) => n.toLowerCase(),
  ),
)

// Mirrors scripts/seed.ts labels for the highlight keys.
const LABELS: Record<string, string> = {
  'calisthenics.pull_up_bars': 'Pull-up bars',
  'calisthenics.parallel_bars': 'Parallel bars',
  'calisthenics.rings': 'Rings',
  'calisthenics.monkey_bars': 'Monkey bars',
  'calisthenics.dip_bars': 'Dip bars',
  'calisthenics.lighting': 'Lighting',
  'calisthenics.access_24_7': '24/7 access',
  'outdoor-gyms.lighting': 'Lighting',
  'outdoor-gyms.access_24_7': '24/7 access',
  'outdoor-gyms.shaded': 'Shaded',
  'outdoor-gyms.free': 'Free',
}
const attrLabel = (slug: string, key: string): string | undefined => LABELS[`${slug}.${key}`]

const candidate = (over: Partial<EnrichCandidate>): EnrichCandidate => ({
  name: 'Drinking water',
  city: 'Istanbul',
  attrs: {},
  categorySlugs: ['drinking-water'],
  ...over,
})

describe('composeInformativeName (P1-11a)', () => {
  it('generic fallback name + city → "<Base> — <City>"', () => {
    expect(composeInformativeName(candidate({}), CATEGORY_NAMES, attrLabel)).toBe('Drinking water — Istanbul')
  })

  it('category-name match is case-insensitive ("drinking water" ≡ category "Drinking Water")', () => {
    expect(composeInformativeName(candidate({ name: 'drinking water' }), CATEGORY_NAMES, attrLabel)).toBe(
      'drinking water — Istanbul',
    )
    expect(composeInformativeName(candidate({ name: 'Vanlife Spots', city: 'Berlin' }), CATEGORY_NAMES, attrLabel)).toBe(
      'Vanlife Spots — Berlin',
    )
  })

  it('calisthenics parks get up to 2 notable true bool attrs in priority order', () => {
    const c = candidate({
      name: 'Calisthenics park',
      city: 'Berlin',
      categorySlugs: ['calisthenics', 'outdoor-gyms'],
      attrs: {
        'calisthenics.pull_up_bars': true,
        'calisthenics.rings': true,
        'calisthenics.lighting': true, // third true attr — must NOT appear
      },
    })
    expect(composeInformativeName(c, CATEGORY_NAMES, attrLabel)).toBe(
      'Calisthenics park (pull-up bars, rings) — Berlin',
    )
  })

  it('false/absent bools are never highlights (never invent booleans)', () => {
    const c = candidate({
      name: 'Calisthenics park',
      city: 'Berlin',
      categorySlugs: ['calisthenics'],
      attrs: { 'calisthenics.rings': false, 'calisthenics.pull_up_bars': true },
    })
    expect(composeInformativeName(c, CATEGORY_NAMES, attrLabel)).toBe('Calisthenics park (pull-up bars) — Berlin')
  })

  it('outdoor-gyms-only places use the outdoor-gyms highlight list', () => {
    const c = candidate({
      name: 'Fitness station',
      city: 'Munich',
      categorySlugs: ['outdoor-gyms'],
      attrs: { 'outdoor-gyms.lighting': true, 'calisthenics.pull_up_bars': true /* wrong namespace → ignored */ },
    })
    expect(composeInformativeName(c, CATEGORY_NAMES, attrLabel)).toBe('Fitness station (lighting) — Munich')
  })

  it('dual-categorized places never repeat a highlight label (real-data bug)', () => {
    // access_24_7=true under BOTH calisthenics and outdoor-gyms must appear once.
    const c = candidate({
      name: 'Calisthenics park',
      city: 'Berlin',
      categorySlugs: ['calisthenics', 'outdoor-gyms'],
      attrs: { 'calisthenics.access_24_7': true, 'outdoor-gyms.access_24_7': true },
    })
    expect(composeInformativeName(c, CATEGORY_NAMES, attrLabel)).toBe('Calisthenics park (24/7 access) — Berlin')
  })

  it('idempotent: already-composed names (" — ") return null', () => {
    expect(
      composeInformativeName(candidate({ name: 'Drinking water — Istanbul' }), CATEGORY_NAMES, attrLabel),
    ).toBeNull()
  })

  it('real names and city-less places return null (untouched)', () => {
    expect(
      composeInformativeName(candidate({ name: 'Maçka Calisthenics Park' }), CATEGORY_NAMES, attrLabel),
    ).toBeNull()
    expect(composeInformativeName(candidate({ city: '  ' }), CATEGORY_NAMES, attrLabel)).toBeNull()
  })
})

describe('genericNames heuristic (shared with the sitemap — CRITICAL COUPLING)', () => {
  it('covers every importer fallback base', () => {
    // The complete fallbackName set from scripts/import-osm.ts.
    for (const base of [
      'Calisthenics park', 'Fitness station', 'Climbing spot', 'Skatepark', 'Parkour spot',
      'Basketball court', 'Table tennis table', 'Motorhome stopover', 'Caravan site',
      'Sanitary dump station', 'Water point', 'Public shower', 'Drinking water', 'BBQ area',
      'Picnic site', 'Picnic table', 'Beach swim spot', 'Bathing place', 'Swimming area', 'Viewpoint',
    ]) {
      expect(isGenericImportName(base, CATEGORY_NAMES), base).toBe(true)
    }
  })

  it('GENERIC_FALLBACK_NAME_RE matches bare AND composed variants', () => {
    for (const ok of [
      'Drinking water',
      'drinking water',
      'Bench',
      'Viewpoint',
      'Drinking water — Istanbul',
      'Calisthenics park (pull-up bars, rings) — Berlin',
      'Picnic table – Barcelona',
    ]) {
      expect(GENERIC_FALLBACK_NAME_RE.test(ok), ok).toBe(true)
    }
    for (const no of ['Maçka Calisthenics Park', 'Maçka Calisthenics Park — Istanbul', 'Ringspark', 'Waterfront']) {
      expect(GENERIC_FALLBACK_NAME_RE.test(no), no).toBe(false)
    }
  })

  it('category-name bases stay generic when composed ("Calisthenics Parks — Berlin")', () => {
    expect(isGenericImportName('Calisthenics Parks', CATEGORY_NAMES)).toBe(true)
    expect(isGenericImportName('Calisthenics Parks — Berlin', CATEGORY_NAMES)).toBe(true)
    expect(isGenericImportName('Maçka Calisthenics Park — Istanbul', CATEGORY_NAMES)).toBe(false)
  })

  it('genericNameBase strips the city suffix and attr parenthetical', () => {
    expect(genericNameBase('Calisthenics park (pull-up bars, rings) — Berlin')).toBe('Calisthenics park')
    expect(genericNameBase('Drinking water — Istanbul')).toBe('Drinking water')
    expect(genericNameBase('Maçka Calisthenics Park')).toBe('Maçka Calisthenics Park')
  })

  it('ATTR_HIGHLIGHTS only references attrs that exist in the seed schema', () => {
    // Guard against typos: every highlight key must have a seeded label.
    for (const [slug, keys] of Object.entries(ATTR_HIGHLIGHTS)) {
      for (const key of keys) {
        expect(LABELS[`${slug}.${key}`], `${slug}.${key}`).toBeDefined()
      }
    }
  })
})
