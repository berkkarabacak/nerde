// Nerde photo enrichment (MVP_BACKLOG P1-11b, CRITICAL_REVIEW B1c): seed
// Wikimedia Commons photos for showcase places so DoD step 10 ("see useful
// information and photos") stops failing. Commons licenses are ODbL-compatible
// for our use (we keep only CC0 / CC-BY / CC-BY-SA / Public domain and record
// per-photo attribution in the place description).
//
// Run:  node scripts/enrich-photos.ts                 dry run (default): prints
//                                                     the plan, ZERO writes
//       node scripts/enrich-photos.ts --write         download + insert + credit
//       node scripts/enrich-photos.ts --limit=5       process fewer places
// (package.json is orchestrator-owned, so there is intentionally no npm alias.)
//
// Behaviour:
//   • Candidates: up to 60 published places with NO photos and a NON-generic
//     real name (not a category name, not an importer fallback — shared
//     heuristic from server/genericNames.ts), preferring the showcase
//     categories photo-spots / viewpoints / calisthenics / skateparks /
//     climbing, then most-confirmed.
//   • Per place: Commons API generator=geosearch (ggsradius=500, ggslimit=5,
//     iiurlwidth=800, prop=imageinfo with extmetadata LicenseShortName +
//     Artist) at the place's coords; first image with a compatible license
//     wins; its 800px thumb is saved to NERDE_UPLOAD_DIR as
//     commons-<placeid>-1.<jpg|png> (extension from magic bytes), a photos row
//     is inserted, and one credit line is appended to the description:
//     "Photo: <Artist>, <License> via Wikimedia Commons."
//   • Etiquette (Commons/WMF policy): identifying User-Agent carrying
//     NERDE_OSM_ATTRIBUTION_EMAIL, max 1 HTTP request per 1.5 s, stop after 60
//     places or 25 minutes, whichever first.
//   • Idempotent: places that already have photos (or whose description
//     already carries a Commons credit) are skipped; re-runs are no-ops.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { envPath, getDb } from '../server/db.ts'
import { isGenericImportName } from '../server/genericNames.ts'

// ── Pure helpers (unit-tested; no DB, no network) ────────────────────────────

/**
 * Licenses we may republish with attribution: CC0, Public domain, CC BY
 * (any version), CC BY-SA (any version). Explicitly NOT: NC/ND variants,
 * GFDL-only, "Attribution" (non-CC), or anything unrecognized.
 */
export function isCompatibleLicense(shortName: string): boolean {
  const v = shortName.trim().toLowerCase()
  if (v === '') return false
  if (v.startsWith('cc0')) return true
  if (v.startsWith('public domain')) return true
  if (/^cc by(?!-)/.test(v)) return true // CC BY 2.0/2.5/3.0/4.0 — not CC BY-NC / CC BY-ND
  if (/^cc by-sa/.test(v)) return true
  return false
}

/** Strip HTML tags + the common entities from Commons' Artist field. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** The single credit line appended to a place description. */
export function buildCreditLine(artist: string, license: string): string {
  return `Photo: ${artist}, ${license} via Wikimedia Commons.`
}

/** One page entry from the Commons API response (formatversion=2). */
export interface CommonsPage {
  title?: string
  index?: number
  imageinfo?: Array<{
    url?: string
    thumburl?: string
    thumbwidth?: number
    thumbheight?: number
    width?: number
    height?: number
    extmetadata?: {
      LicenseShortName?: { value?: string }
      Artist?: { value?: string }
    }
  }>
}

export interface CommonsPick {
  title: string
  thumbUrl: string
  width: number | null
  height: number | null
  license: string
  artist: string
}

/**
 * Pick the first geosearch result (API relevance order, via `index`) whose
 * license is compatible. Returns null when nothing usable is nearby.
 */
export function pickLicensedImage(pages: CommonsPage[]): CommonsPick | null {
  const ordered = pages.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  for (const page of ordered) {
    const ii = page.imageinfo?.[0]
    const license = ii?.extmetadata?.LicenseShortName?.value?.trim() ?? ''
    if (!ii?.thumburl || !isCompatibleLicense(license)) continue
    const artist = stripHtml(ii.extmetadata?.Artist?.value ?? '') || 'Unknown author'
    return {
      title: page.title ?? '',
      thumbUrl: ii.thumburl,
      width: ii.thumbwidth ?? ii.width ?? null,
      height: ii.thumbheight ?? ii.height ?? null,
      license,
      artist: artist.slice(0, 120),
    }
  }
  return null
}

// ── Script pipeline ──────────────────────────────────────────────────────────

const API_URL = 'https://commons.wikimedia.org/w/api.php'
const MAX_PLACES_DEFAULT = 60
const TIME_BUDGET_MS = 25 * 60 * 1000 // 25 minutes, whichever limit hits first
const MIN_REQUEST_GAP_MS = 1500 // ≤ 1 request / 1.5 s, API + download combined
const PREFERRED_CATEGORIES = ['photo-spots', 'viewpoints', 'calisthenics', 'skateparks', 'climbing']

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let lastRequestAt = 0

/** Every outbound request goes through here: polite pacing + identifying UA. */
async function throttledFetch(url: string): Promise<Response> {
  const email = process.env.NERDE_OSM_ATTRIBUTION_EMAIL ?? 'hello@example.com'
  const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt)
  if (lastRequestAt > 0 && wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
  return fetch(url, {
    headers: { 'user-agent': `NerdeCommonsEnrich/0.1 (contact: ${email})`, accept: 'application/json,*/*' },
    signal: AbortSignal.timeout(60_000),
  })
}

interface Candidate {
  id: number
  slug: string
  name: string
  lat: number
  lng: number
  description: string
}

function selectCandidates(limit: number): Candidate[] {
  const db = getDb()
  const categoryNamesLower = new Set(
    (db.prepare('SELECT name FROM categories').all() as Array<{ name: string }>).map((c) =>
      c.name.toLowerCase(),
    ),
  )
  // Published, photo-less, preferred showcase categories first. Bounded SQL
  // scan; the non-generic-name filter runs in JS (shared heuristic).
  const rows = db
    .prepare(
      `SELECT p.id, p.slug, p.name, p.lat, p.lng, p.description
       FROM places p
       WHERE p.status = 'published'
         AND NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.place_id = p.id)
       ORDER BY CASE WHEN EXISTS (
                   SELECT 1 FROM place_categories pc JOIN categories c ON c.id = pc.category_id
                   WHERE pc.place_id = p.id AND c.slug IN (${PREFERRED_CATEGORIES.map(() => '?').join(',')})
                 ) THEN 0 ELSE 1 END,
                p.confirm_count DESC, p.id
       LIMIT 500`,
    )
    .all(...PREFERRED_CATEGORIES) as Candidate[]
  return rows.filter((r) => !isGenericImportName(r.name, categoryNamesLower)).slice(0, limit)
}

async function geosearch(lat: number, lng: number): Promise<CommonsPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'geosearch',
    ggscoord: `${lat}|${lng}`,
    ggsradius: '500',
    ggslimit: '5',
    ggsnamespace: '6', // File: — without this Commons returns ns=0 gallery pages
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '800',
  })
  const res = await throttledFetch(`${API_URL}?${params.toString()}`)
  if (!res.ok) throw new Error(`Commons API HTTP ${res.status}`)
  const body = (await res.json()) as { query?: { pages?: CommonsPage[] } }
  return body.query?.pages ?? []
}

export async function main(argv: string[]): Promise<void> {
  const write = argv.includes('--write')
  const limitArg = argv.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? Math.max(1, Math.floor(Number(limitArg.slice('--limit='.length)))) : MAX_PLACES_DEFAULT
  if (!Number.isFinite(limit)) {
    console.error('--limit must be a positive integer')
    process.exit(2)
  }

  const started = Date.now()
  const candidates = selectCandidates(limit)
  console.log(
    `enrich-photos — ${write ? 'WRITE' : 'DRY RUN (no downloads, no DB writes)'} mode\n` +
      `candidates=${candidates.length} (limit ${limit}, time budget ${TIME_BUDGET_MS / 60000} min)`,
  )

  const uploadDir = envPath('NERDE_UPLOAD_DIR', './public/uploads')
  const stats = { picked: 0, noImage: 0, errors: 0, enriched: 0 }

  for (const place of candidates) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      console.log(`\nTime budget reached after ${stats.enriched + stats.noImage + stats.errors} place(s) — stopping.`)
      break
    }
    let pick: CommonsPick | null = null
    try {
      pick = pickLicensedImage(await geosearch(place.lat, place.lng))
    } catch (err) {
      stats.errors++
      console.log(`  ✗ #${place.id} ${place.name}: ${(err as Error).message}`)
      continue
    }
    if (!pick) {
      stats.noImage++
      console.log(`  – #${place.id} ${place.name}: no licensed image within 500 m`)
      continue
    }
    stats.picked++
    console.log(
      `  ${write ? '→' : '•'} #${place.id} "${place.name}" → ${pick.title} [${pick.license}] by ${pick.artist}`,
    )
    if (!write) continue

    // ── WRITE path: download, sniff, store, then one small transaction. ──
    try {
      const imgRes = await throttledFetch(pick.thumbUrl)
      if (!imgRes.ok) throw new Error(`download HTTP ${imgRes.status}`)
      const buf = Buffer.from(await imgRes.arrayBuffer())
      let ext: string
      if (buf.subarray(0, 3).equals(JPEG_MAGIC)) ext = 'jpg'
      else if (buf.subarray(0, 8).equals(PNG_MAGIC)) ext = 'png'
      else throw new Error('download is not a JPEG/PNG (unexpected Content-Type)')

      fs.mkdirSync(uploadDir, { recursive: true })
      const fileName = `commons-${place.id}-1.${ext}`
      const filePath = path.join(uploadDir, fileName)
      fs.writeFileSync(filePath, buf)

      const db = getDb()
      const credit = buildCreditLine(pick.artist, pick.license)
      db.exec('BEGIN')
      try {
        // Re-check inside the transaction: another writer may have added a
        // photo or credit meanwhile (keeps re-runs no-ops).
        const fresh = db
          .prepare(
            `SELECT p.description, EXISTS(SELECT 1 FROM photos ph WHERE ph.place_id = p.id) AS has_photo
             FROM places p WHERE p.id = ?`,
          )
          .get(place.id) as { description: string; has_photo: number } | undefined
        if (!fresh || fresh.has_photo === 1 || fresh.description.includes('via Wikimedia Commons')) {
          db.exec('ROLLBACK')
          fs.rmSync(filePath, { force: true })
          console.log(`    skipped #${place.id} — photo/credit appeared meanwhile`)
          continue
        }
        db.prepare('INSERT INTO photos (place_id, url, width, height, created_by) VALUES (?, ?, ?, ?, NULL)').run(
          place.id,
          `/uploads/${fileName}`,
          pick.width,
          pick.height,
        )
        const desc = fresh.description.trim()
        db.prepare(`UPDATE places SET description = ?, updated_at = datetime('now') WHERE id = ?`).run(
          desc === '' ? credit : `${desc}\n\n${credit}`,
          place.id,
        )
        db.exec('COMMIT')
      } catch (err) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // already rolled back
        }
        fs.rmSync(filePath, { force: true }) // no orphan file behind a failed row
        throw err
      }
      stats.enriched++
    } catch (err) {
      stats.errors++
      console.log(`    ✗ #${place.id}: ${(err as Error).message}`)
    }
  }

  console.log(
    `\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s — ` +
      `licensed-image-found=${stats.picked} no-image=${stats.noImage} errors=${stats.errors}` +
      (write ? ` enriched=${stats.enriched}` : ' (dry run: nothing written; re-run with --write to apply)'),
  )
}

// Run main() only when executed directly, so tests can import the pure helpers
// without network or DB side effects (pathToFileURL compare is Windows-safe).
const invokedAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedAsScript) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`enrich-photos failed: ${(err as Error).message}`)
    process.exitCode = 1
  })
}
