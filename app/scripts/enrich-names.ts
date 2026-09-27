// Nerde name enrichment (MVP_BACKLOG P1-11a, CRITICAL_REVIEW B1b).
//
// Rewrites generic imported names ("Drinking water" ×7k, "Picnic table" ×5k…)
// into informative, city-scoped ones: "<Base name> — <City>", and for
// calisthenics / outdoor-gyms additionally up to 2 notable true bool attrs:
// "Calisthenics park (pull-up bars, rings) — Berlin".
//
// Run:  node scripts/enrich-names.ts            dry run (default): prints 10
//                                               samples + total counts, ZERO writes
//       node scripts/enrich-names.ts --write    apply in ONE transaction
// (package.json is orchestrator-owned, so there is intentionally no npm alias;
//  mirrors how `node scripts/import-osm.ts` is invoked.)
//
// Rules:
//   • Candidates: name equals a category name (case-insensitive) or matches
//     the generic fallback set — SAME heuristic as the sitemap thin-place
//     exclusion, shared via server/genericNames.ts (keep them in sync!).
//   • Idempotent: names already containing " — " are never touched, so
//     re-runs are no-ops.
//   • Places with empty `city` are skipped (run scripts/backfill-city.ts
//     first); community-authored real names are never rewritten.
//   • Slugs are immutable by design (URL permanence) — only `name` changes.
//   • updated_at is bumped so sitemap lastmod reflects the change.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDb } from '../server/db.ts'
import { isGenericImportName } from '../server/genericNames.ts'

// ── Pure compose logic (unit-tested; no DB access) ───────────────────────────

/** Input the composer needs — everything else stays out of scope. */
export interface EnrichCandidate {
  name: string
  city: string
  /** Parsed places.attrs JSON: {"calisthenics.pull_up_bars": true, …}. */
  attrs: Record<string, unknown>
  /** Category slugs the place belongs to. */
  categorySlugs: string[]
}

/**
 * Notable bool attrs eligible for the "(…)" highlight, in priority order.
 * Only calisthenics / outdoor-gyms get highlights (spec P1-11a); keys must be
 * literally `true` in attrs — never invent booleans from absence.
 */
export const ATTR_HIGHLIGHTS: Record<string, string[]> = {
  calisthenics: ['pull_up_bars', 'parallel_bars', 'rings', 'monkey_bars', 'dip_bars', 'lighting', 'access_24_7'],
  'outdoor-gyms': ['lighting', 'access_24_7', 'shaded', 'free'],
}

const MAX_NAME_LEN = 80 // contract name cap (CONTRACTS §6 POST /api/places)

/** "Pull-up bars" → "pull-up bars" (parenthetical reads as a list, not a title). */
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * Compose the informative name, or return null when the place is not a
 * generic-named candidate (already composed, real name, or no city).
 * `attrLabel` resolves an attr key to its seeded human label.
 */
export function composeInformativeName(
  place: EnrichCandidate,
  categoryNamesLower: ReadonlySet<string>,
  attrLabel: (categorySlug: string, key: string) => string | undefined,
): string | null {
  const name = place.name.trim()
  if (name.includes(' — ')) return null // already enriched (idempotent)
  if (!isGenericImportName(name, categoryNamesLower)) return null // real name
  const city = place.city.trim()
  if (city === '') return null // nothing to compose with — backfill-city first

  // Up to 2 notable true bool attrs, calisthenics first (more specific).
  // Dedupe by label: a dual-categorized place (calisthenics + outdoor-gyms)
  // can carry e.g. access_24_7=true under both namespaces — show it once.
  const highlights: string[] = []
  for (const slug of ['calisthenics', 'outdoor-gyms']) {
    if (!place.categorySlugs.includes(slug)) continue
    for (const key of ATTR_HIGHLIGHTS[slug] ?? []) {
      if (highlights.length >= 2) break
      if (place.attrs[`${slug}.${key}`] === true) {
        const label = lowerFirst(attrLabel(slug, key) ?? key.replace(/_/g, ' '))
        if (!highlights.includes(label)) highlights.push(label)
      }
    }
  }

  const base = highlights.length > 0 ? `${name} (${highlights.join(', ')})` : name
  const composed = `${base} — ${city}`
  if (composed.length <= MAX_NAME_LEN) return composed
  // Over the cap → retry without the parenthetical; still over → skip.
  const plain = `${name} — ${city}`
  return plain.length <= MAX_NAME_LEN ? plain : null
}

// ── Script pipeline ──────────────────────────────────────────────────────────

interface PlaceRow {
  id: number
  name: string
  city: string
  attrs: string
  /** Comma-joined category slugs (GROUP_CONCAT), empty string when none. */
  cats: string | null
}

interface Rename {
  id: number
  from: string
  to: string
}

export async function main(argv: string[]): Promise<void> {
  const write = argv.includes('--write')
  const db = getDb()

  // Category names (lowercased) + attr labels — same sources the sitemap and
  // the place page use.
  const categories = db.prepare('SELECT id, slug, name FROM categories').all() as Array<{
    id: number
    slug: string
    name: string
  }>
  const categoryNamesLower = new Set(categories.map((c) => c.name.toLowerCase()))
  const attrLabels = new Map<string, string>()
  for (const row of db
    .prepare(
      `SELECT c.slug AS slug, a.key AS key, a.label AS label
       FROM category_attributes a JOIN categories c ON c.id = a.category_id`,
    )
    .all() as Array<{ slug: string; key: string; label: string }>) {
    attrLabels.set(`${row.slug}.${row.key}`, row.label)
  }
  const attrLabel = (slug: string, key: string): string | undefined => attrLabels.get(`${slug}.${key}`)

  const places = db
    .prepare(
      `SELECT p.id, p.name, p.city, p.attrs,
              (SELECT GROUP_CONCAT(c.slug) FROM place_categories pc
               JOIN categories c ON c.id = pc.category_id WHERE pc.place_id = p.id) AS cats
       FROM places p ORDER BY p.id`,
    )
    .all() as PlaceRow[]

  const renames: Rename[] = []
  let alreadyComposed = 0
  let realNames = 0
  let noCity = 0
  for (const p of places) {
    if (p.name.includes(' — ')) {
      alreadyComposed++
      continue
    }
    if (!isGenericImportName(p.name, categoryNamesLower)) {
      realNames++
      continue
    }
    if (p.city.trim() === '') {
      noCity++
      continue
    }
    let attrs: Record<string, unknown> = {}
    try {
      attrs = JSON.parse(p.attrs) as Record<string, unknown>
    } catch {
      // malformed attrs JSON → no highlights, name still composes
    }
    const to = composeInformativeName(
      { name: p.name, city: p.city, attrs, categorySlugs: (p.cats ?? '').split(',').filter(Boolean) },
      categoryNamesLower,
      attrLabel,
    )
    if (to !== null && to !== p.name) renames.push({ id: p.id, from: p.name, to })
  }

  console.log(
    `enrich-names — ${write ? 'WRITE' : 'DRY RUN (no DB writes)'} mode\n` +
      `scanned=${places.length} to-rename=${renames.length} ` +
      `skipped: real-name=${realNames} already-composed=${alreadyComposed} no-city=${noCity}`,
  )
  console.log('\n── Samples (max 10) ─────────────────────────────────────────────────────')
  for (const r of renames.slice(0, 10)) {
    console.log(`  #${r.id}  "${r.from}"  →  "${r.to}"`)
  }
  if (renames.length === 0) console.log('  (nothing to rename)')

  if (!write) {
    console.log('\nDry run only — re-run with --write to apply.')
    return
  }

  // Single transaction; the `AND name = ?` guard makes the update optimistic
  // against any concurrent writer (a renamed-elsewhere row just skips).
  const stmt = db.prepare(`UPDATE places SET name = ?, updated_at = datetime('now') WHERE id = ? AND name = ?`)
  db.exec('BEGIN')
  let applied = 0
  try {
    for (const r of renames) {
      const res = stmt.run(r.to, r.id, r.from)
      applied += Number(res.changes)
    }
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // already rolled back
    }
    throw err
  }
  console.log(`\nApplied ${applied} rename(s) in one transaction.`)
}

// Run main() only when executed directly (`node scripts/enrich-names.ts`), so
// tests can import the pure helpers without touching the DB. import-osm.ts has
// no such guard (it always runs); the pathToFileURL compare is Windows-safe.
const invokedAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedAsScript) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`enrich-names failed: ${(err as Error).message}`)
    process.exitCode = 1
  })
}
