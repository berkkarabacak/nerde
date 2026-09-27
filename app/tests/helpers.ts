// Shared test plumbing for the Nerde API suite.
//
// Strategy: each test file runs in its own vitest worker process. Inside a
// file, `freshDb()` points NERDE_DB_PATH / NERDE_UPLOAD_DIR at a fresh temp
// directory and re-opens the lazy DB singleton (migrations run on open), so
// every test gets an isolated, empty, migrated database. Requests go through
// a real throwaway node:http server on an ephemeral port running handleApi,
// exercising the full router incl. CSRF + rate-limit guards.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { closeDb, getDb } from '../server/db.ts'
import { handleApi } from '../server/index.ts'
import { resetRateLimits } from '../server/rateLimit.ts'
import { hashPassword } from '../server/auth.ts'

// ── HTTP server ──────────────────────────────────────────────────────────────

export interface TestServer {
  base: string
  close: () => Promise<void>
}

export async function startServer(): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    handleApi(req, res)
      .then((handled) => {
        if (!handled) {
          res.statusCode = 404
          res.end('not found')
        }
      })
      .catch((err) => {
        if (!res.writableEnded) {
          res.statusCode = 500
          res.end(String(err))
        }
      })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  return {
    base: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

// ── API client ───────────────────────────────────────────────────────────────

export interface ApiOptions {
  body?: unknown
  /** Raw Cookie header value, e.g. `nerde_session=abc`. */
  cookie?: string
  headers?: Record<string, string>
  /** Send a pre-serialized body with an explicit content-type (CSRF tests). */
  rawBody?: string
  rawContentType?: string
}

export interface ApiResult {
  status: number
  /** Parsed JSON body, or null for empty/non-JSON responses. */
  body: Record<string, any> | null
  text: string
  contentType: string
  setCookie: string
}

let ipCounter = 10
/** Each call uses a fresh X-Forwarded-For so rate-limit buckets stay isolated per requester. */
export async function api(
  base: string,
  method: string,
  urlPath: string,
  opts: ApiOptions = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    'x-forwarded-for': `10.0.0.${ipCounter++ % 250}`,
    ...opts.headers,
  }
  let body: string | undefined
  if (opts.rawBody !== undefined) {
    body = opts.rawBody
    if (opts.rawContentType) headers['content-type'] = opts.rawContentType
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['content-type'] = 'application/json'
  }
  if (opts.cookie) headers.cookie = opts.cookie
  const res = await fetch(base + urlPath, { method, headers, body })
  const text = await res.text()
  let parsed: Record<string, any> | null = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // non-JSON (sitemap.xml, robots.txt)
  }
  return {
    status: res.status,
    body: parsed,
    text,
    contentType: res.headers.get('content-type') ?? '',
    setCookie: res.headers.get('set-cookie') ?? '',
  }
}

/** Extract the nerde_session cookie value from a set-cookie header. */
export function sessionCookie(setCookie: string): string {
  const match = /nerde_session=[^;]+/.exec(setCookie)
  if (!match) throw new Error(`no nerde_session in set-cookie: ${setCookie}`)
  return match[0]
}

// ── Database fixtures ────────────────────────────────────────────────────────

const tmpRoots: string[] = []

/**
 * Open a brand-new temp DB (migrations applied) and, by default, seed a
 * minimal category set with attribute definitions used across the suite.
 */
export function freshDb(seed = true): DatabaseSync {
  closeDb()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerde-test-'))
  tmpRoots.push(dir)
  process.env.NERDE_DB_PATH = path.join(dir, 'test.sqlite')
  process.env.NERDE_UPLOAD_DIR = path.join(dir, 'uploads')
  resetRateLimits()
  const db = getDb()
  if (seed) seedCategories(db)
  return db
}

export function cleanupTmp(): void {
  closeDb()
  for (const dir of tmpRoots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort on Windows file locking
    }
  }
}

/** Minimal but realistic category set (mirrors CONTRACTS §4 shapes). */
export function seedCategories(db: DatabaseSync): void {
  const insCat = db.prepare(
    `INSERT INTO categories (slug, name, icon, color, grp, sort) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insAttr = db.prepare(
    `INSERT INTO category_attributes (category_id, key, label, type, options, filterable, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const cat = (
    slug: string,
    name: string,
    grp: string,
    sort: number,
    attrs: Array<[key: string, type: string, filterable: number, options?: string[]]>,
  ): number => {
    const id = (insCat.run(slug, name, '📍', '#2563eb', grp, sort).lastInsertRowid as number)
    attrs.forEach(([key, type, filterable, options], i) => {
      insAttr.run(id, key, key.replace(/_/g, ' '), type, options ? JSON.stringify(options) : null, filterable, i + 1)
    })
    return id
  }
  cat('calisthenics', 'Calisthenics Parks', 'fitness', 1, [
    ['pull_up_bars', 'bool', 1],
    ['parallel_bars', 'bool', 1],
    ['lighting', 'bool', 1],
    ['free', 'bool', 1],
    ['indoor_outdoor', 'enum', 0, ['outdoor', 'indoor']],
    ['ground_surface', 'enum', 0, ['rubber', 'concrete', 'grass', 'sand', 'mixed']],
  ])
  cat('arm-wrestling', 'Arm Wrestling', 'fitness', 2, [
    ['dedicated_club', 'bool', 1],
    ['drop_ins', 'bool', 1],
    ['schedule', 'text', 0],
  ])
  cat('vanlife', 'Vanlife Spots', 'outdoor', 1, [
    ['overnight_allowed', 'bool', 1],
    ['free', 'bool', 1],
    ['quiet', 'bool', 1],
    ['mobile_signal', 'enum', 0, ['none', 'weak', 'good']],
  ])
  cat('sunset-spots', 'Sunset Spots', 'outdoor', 2, [
    ['crowded', 'enum', 1, ['quiet', 'moderate', 'busy']],
    ['seating', 'bool', 0],
  ])
}

let placeCounter = 0

/** Insert a place directly (fast fixture setup for read-side tests). */
export function insertPlace(
  db: DatabaseSync,
  opts: {
    name?: string
    lat: number
    lng: number
    cats?: string[]
    attrs?: Record<string, boolean | number | string>
    status?: string
    description?: string
    city?: string
    country?: string
    country_code?: string
  },
): { id: number; slug: string } {
  placeCounter++
  const name = opts.name ?? `Fixture Place ${placeCounter}`
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-fx${placeCounter.toString(36)}`
  const id = db
    .prepare(
      `INSERT INTO places (slug, name, description, lat, lng, attrs, status, source, city, country, country_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'community', ?, ?, ?) RETURNING id`,
    )
    .get(
      slug,
      name,
      opts.description ?? '',
      opts.lat,
      opts.lng,
      JSON.stringify(opts.attrs ?? {}),
      opts.status ?? 'published',
      opts.city ?? '',
      opts.country ?? '',
      opts.country_code ?? '',
    ) as { id: number }
  for (const slugCat of opts.cats ?? []) {
    const catRow = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slugCat) as
      | { id: number }
      | undefined
    if (!catRow) throw new Error(`fixture category ${slugCat} not seeded`)
    db.prepare('INSERT OR IGNORE INTO place_categories (place_id, category_id) VALUES (?, ?)').run(
      id.id,
      catRow.id,
    )
  }
  return { id: id.id, slug }
}

/** Create a user row directly and return credentials + id. */
export function insertUser(
  db: DatabaseSync,
  role: 'user' | 'admin' = 'user',
  overrides: { email?: string; username?: string; password?: string } = {},
): { id: number; email: string; username: string; password: string } {
  placeCounter++
  const email = overrides.email ?? `user${placeCounter}@example.com`
  const username = overrides.username ?? `user${placeCounter}`
  const password = overrides.password ?? 'password-123'
  const row = db
    .prepare(`INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id`)
    .get(email, username, hashPassword(password), role) as { id: number }
  return { id: row.id, email, username, password }
}

/** Sign up via the API and return the session cookie. */
export async function signupAndCookie(
  base: string,
  email: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await api(base, 'POST', '/api/auth/signup', { body: { email, username, password } })
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${res.text}`)
  return sessionCookie(res.setCookie)
}
