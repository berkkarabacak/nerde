// Authentication for Nerde.com (CONTRACTS §1/§6):
// email+password, scrypt hash in `scrypt$N$r$p$salt$hash` hex format, session
// token in an httpOnly SameSite=Lax cookie (`nerde_session`, 30 days), sessions
// table, timing-safe comparisons. Route handlers for signup/login/logout/me
// live here too; the router imports them.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getDb } from './db.ts'
import { httpError, json } from './http.ts'
import type { Ctx, SessionUser } from './http.ts'
import { asTrimmed, isEmail, isUsername, parseCookies, readJson, requireString } from './validate.ts'

// scrypt parameters pinned by the contract hash format `scrypt$16384$8$1$…`.
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const SESSION_COOKIE = 'nerde_session'
const SESSION_DAYS = 30
const SESSION_MAX_AGE_SEC = SESSION_DAYS * 24 * 60 * 60

/** Hash a password as `scrypt$16384$8$1$<salt hex>$<hash hex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`
}

/** Verify a password against a stored hash (timing-safe; format-tolerant). */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = Buffer.from(parts[4], 'hex')
  const expected = Buffer.from(parts[5], 'hex')
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false
  if (salt.length === 0 || expected.length === 0) return false
  const actual = scryptSync(password, salt, expected.length, { N, r, p })
  return timingSafeEqual(actual, expected)
}

/** Set the session cookie (httpOnly, SameSite=Lax, 30-day expiry). */
function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}`,
  )
}

/** Expire the session cookie immediately (logout). */
function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

/** Create a session row (256-bit token, 30-day expiry) and set the cookie. */
export function startSession(res: ServerResponse, userId: number): void {
  const token = randomBytes(32).toString('hex')
  getDb()
    .prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`)
    .run(token, userId)
  setSessionCookie(res, token)
}

/**
 * Resolve the session cookie to a user. Returns null when missing/expired.
 * Expired rows are swept opportunistically on login; the expiry predicate here
 * is authoritative.
 */
export function getSessionUser(req: IncomingMessage): SessionUser | null {
  const token = parseCookies(req)[SESSION_COOKIE]
  if (!token || token.length > 128) return null
  const row = getDb()
    .prepare(
      `SELECT u.id, u.username, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as { id: number; username: string; role: string } | undefined
  if (!row) return null
  return { id: row.id, username: row.username, role: row.role === 'admin' ? 'admin' : 'user' }
}

/** Throw 401 unless the request is authenticated. */
export function requireAuth(ctx: Ctx): SessionUser {
  if (!ctx.user) throw httpError(401, 'authentication required')
  return ctx.user
}

/** Throw 403 unless the request is authenticated as admin (CONTRACTS §6: else 403). */
export function requireAdmin(ctx: Ctx): SessionUser {
  if (!ctx.user || ctx.user.role !== 'admin') throw httpError(403, 'admin access required')
  return ctx.user
}

// ── Route handlers ───────────────────────────────────────────────────────────

interface UserRow {
  id: number
  email: string
  username: string
  password_hash: string
  role: string
}

function publicUser(row: { id: number; username: string; role: string }): SessionUser {
  return { id: row.id, username: row.username, role: row.role === 'admin' ? 'admin' : 'user' }
}

/** POST /api/auth/signup — create account, set cookie. 409 on taken email/username. */
export async function signup(ctx: Ctx): Promise<void> {
  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const email = asTrimmed(body.email, 254).toLowerCase()
  const username = asTrimmed(body.username, 30)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!isEmail(email)) throw httpError(400, 'a valid email is required')
  if (!isUsername(username)) {
    throw httpError(400, 'username must be 2–30 chars: letters, numbers, _ or -')
  }
  if (password.length < 8 || password.length > 100) {
    throw httpError(400, 'password must be 8–100 chars')
  }
  const db = getDb()
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw httpError(409, 'email already taken')
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    throw httpError(409, 'username already taken')
  }
  const inserted = db
    .prepare(`INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?) RETURNING id`)
    .get(email, username, hashPassword(password)) as { id: number }
  startSession(ctx.res, inserted.id)
  json(ctx.res, 201, { user: { id: inserted.id, username, role: 'user' } })
}

/** POST /api/auth/login — verify credentials, set cookie. 401 on bad creds. */
export async function login(ctx: Ctx): Promise<void> {
  const body = (await readJson(ctx.req)) as Record<string, unknown>
  const email = asTrimmed(body.email, 254).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const db = getDb()
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
  // Always run the hash comparison so the timing does not reveal whether the
  // account exists.
  const hash = row?.password_hash ?? hashPassword('dummy-password-for-timing')
  const ok = verifyPassword(password, hash)
  if (!row || !ok) throw httpError(401, 'invalid email or password')
  // Sweep expired sessions opportunistically (DATABASE.md §9 lifecycle).
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run()
  startSession(ctx.res, row.id)
  json(ctx.res, 200, { user: publicUser(row) })
}

/** POST /api/auth/logout — revoke the session row + expire the cookie. */
export async function logout(ctx: Ctx): Promise<void> {
  const token = parseCookies(ctx.req)[SESSION_COOKIE]
  if (token) getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
  clearSessionCookie(ctx.res)
  json(ctx.res, 200, { ok: true })
}

/** GET /api/auth/me — `{user:{id,username,role}|null}`. */
export async function me(ctx: Ctx): Promise<void> {
  json(ctx.res, 200, { user: ctx.user ?? null })
}
