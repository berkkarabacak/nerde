// Database access for Nerde.com.
//
// LAZY SINGLETON: the DB file is opened and pending migrations are applied on
// the first getDb() call — never at module import time. This keeps the module
// safe to import from anywhere (vite middleware, prod server, scripts, tests)
// with zero top-level side effects.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** app/ project root = parent of this server/ directory. */
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Resolve an env path relative to the app root (defaults from .env.example). */
export function envPath(envName: string, defaultRel: string): string {
  const raw = process.env[envName] ?? defaultRel
  return path.isAbsolute(raw) ? raw : path.resolve(APP_ROOT, raw)
}

const MIGRATIONS_DIR = path.join(APP_ROOT, 'db', 'migrations')

let db: DatabaseSync | null = null

/** Open (once) the SQLite database and apply pending migrations. */
export function getDb(): DatabaseSync {
  if (db) return db
  const dbPath = envPath('NERDE_DB_PATH', './db/nerde.sqlite')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const conn = new DatabaseSync(dbPath)
  conn.exec('PRAGMA journal_mode = WAL;')
  conn.exec('PRAGMA foreign_keys = ON;') // per-connection: must be re-set on every open
  runMigrations(conn)
  db = conn
  return conn
}

/** Apply db/migrations/*.sql in filename order, tracking applied names. */
function runMigrations(conn: DatabaseSync): void {
  conn.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
       name       TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  )
  if (!fs.existsSync(MIGRATIONS_DIR)) return
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // 001_, 002_, ... lexicographic order is the migration order
  const applied = new Set(
    (conn.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((r) => r.name),
  )
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    try {
      conn.exec('BEGIN')
      conn.exec(sql)
      conn.prepare('INSERT INTO migrations (name) VALUES (?)').run(file)
      conn.exec('COMMIT')
    } catch (err) {
      try {
        conn.exec('ROLLBACK')
      } catch {
        // already rolled back
      }
      throw new Error(`migration ${file} failed: ${(err as Error).message}`)
    }
  }
}

/** Reset the cached connection (used by tests that point NERDE_DB_PATH elsewhere). */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

// ── Geo helpers (DATABASE.md §4) ─────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371
const KM_PER_DEG_LAT = 111.32

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Great-circle distance between two WGS84 points, in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

export interface RadiusBbox {
  s: number
  n: number
  w: number
  e: number
  /** true when the lng band wraps the antimeridian → use the OR predicate. */
  wraps: boolean
  /** true when the lng band covers the whole world → drop the lng predicate. */
  fullLng: boolean
}

/**
 * Over-approximating square prefilter for a radius search (DATABASE.md §4):
 * dlat = km / 111.32; dlng = km / (111.32 · cos(radians(lat))), |lat| clamped
 * to 89.9; dlng ≥ 180° → drop the longitude predicate entirely.
 */
export function bboxForRadius(lat: number, lng: number, radiusKm: number): RadiusBbox {
  const clampedLat = Math.max(-89.9, Math.min(89.9, lat))
  const dLat = radiusKm / KM_PER_DEG_LAT
  const dLng = radiusKm / (KM_PER_DEG_LAT * Math.cos(toRad(clampedLat)))
  const s = Math.max(-90, lat - dLat)
  const n = Math.min(90, lat + dLat)
  if (dLng >= 180) return { s, n, w: -180, e: 180, wraps: false, fullLng: true }
  let w = lng - dLng
  let e = lng + dLng
  let wraps = false
  if (w < -180) {
    w += 360
    wraps = true
  }
  if (e > 180) {
    e -= 360
    wraps = true
  }
  return { s, n, w, e, wraps, fullLng: false }
}

/** Normalize any longitude into [-180, 180] (for bbox inputs that may wrap). */
export function normalizeLng(lng: number): number {
  let v = lng % 360
  if (v > 180) v -= 360
  if (v < -180) v += 360
  return v
}
