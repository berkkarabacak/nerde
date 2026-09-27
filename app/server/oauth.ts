// Google OAuth login (MVP_BACKLOG P1-01) — env-gated.
//
// The whole flow activates only when BOTH NERDE_GOOGLE_CLIENT_ID and
// NERDE_GOOGLE_CLIENT_SECRET are set; otherwise the endpoints 404 and
// GET /api/auth/providers reports {google:false} so the login page hides the
// button. Flow:
//   GET /api/auth/google          → 302 to Google consent, random `state` in a
//                                   10-minute httpOnly SameSite=Lax cookie.
//   GET /api/auth/google/callback → validate state vs cookie (else 400),
//                                   exchange the code (oauth2.googleapis.com),
//                                   fetch the OpenID userinfo, find-or-create
//                                   the user by email (username = email
//                                   local-part with numeric-suffix dedupe;
//                                   existing accounts are linked, not
//                                   duplicated), start a session, 302 to `/`.
// Google being unreachable / rejecting the exchange → 502 with clean JSON.
// Uses the global fetch — no new dependencies.
import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { hashPassword, startSession } from './auth.ts'
import { baseUrl } from './config.ts'
import { getDb } from './db.ts'
import { httpError, json } from './http.ts'
import type { Ctx } from './http.ts'
import { isEmail, parseCookies } from './validate.ts'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const STATE_COOKIE = 'nerde_oauth_state'
const STATE_MAX_AGE_SEC = 10 * 60 // 10 minutes
const GOOGLE_TIMEOUT_MS = 10_000

/** Google client config, or null when the feature is not configured. */
function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.NERDE_GOOGLE_CLIENT_ID ?? '').trim()
  const clientSecret = (process.env.NERDE_GOOGLE_CLIENT_SECRET ?? '').trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

/** Prepend extra cookies to any Set-Cookie header already staged on res. */
function prependCookies(res: ServerResponse, cookies: string[]): void {
  const existing = res.getHeader('set-cookie')
  const list = Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : []
  res.setHeader('set-cookie', [...cookies, ...list])
}

/** GET /api/auth/providers — which social login providers are configured. */
export async function authProviders(ctx: Ctx): Promise<void> {
  json(ctx.res, 200, { google: googleConfig() !== null })
}

/**
 * GET /api/auth/google — start the OAuth flow: 302 to Google's consent screen
 * with a random anti-CSRF `state` mirrored into a short-lived httpOnly cookie.
 */
export async function googleStart(ctx: Ctx): Promise<void> {
  const cfg = googleConfig()
  if (!cfg) throw httpError(404, 'not found')
  const state = randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: `${baseUrl()}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
  })
  ctx.res.statusCode = 302
  ctx.res.setHeader('location', `${GOOGLE_AUTH_URL}?${params.toString()}`)
  ctx.res.setHeader(
    'set-cookie',
    `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${STATE_MAX_AGE_SEC}`,
  )
  ctx.res.end()
}

interface GoogleTokenResponse {
  access_token?: string
}

interface GoogleUserInfo {
  sub?: string
  email?: string
  email_verified?: boolean
}

/** fetch() wrapper: any network/HTTP failure becomes a clean 502. */
async function googleFetch(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) })
  } catch {
    throw httpError(502, 'google sign-in is unavailable right now — please use email login')
  }
  if (!res.ok) {
    throw httpError(502, 'google sign-in is unavailable right now — please use email login')
  }
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    throw httpError(502, 'google returned an unreadable response — please use email login')
  }
}

/**
 * GET /api/auth/google/callback — finish the flow. State mismatch/expiry →
 * 400; Google failure → 502; success → session cookie + 302 to `/`.
 */
export async function googleCallback(ctx: Ctx): Promise<void> {
  const cfg = googleConfig()
  if (!cfg) throw httpError(404, 'not found')

  const cookieState = parseCookies(ctx.req)[STATE_COOKIE] ?? ''
  const sentState = ctx.query.get('state') ?? ''
  if (!cookieState || !sentState || sentState !== cookieState) {
    // Clear the one-shot cookie even on failure so retries start clean.
    ctx.res.setHeader('set-cookie', clearStateCookie())
    throw httpError(400, 'invalid or expired sign-in state — start the Google sign-in again')
  }

  // User declined on Google's side (or Google errored): back to the login page.
  if (ctx.query.get('error')) {
    ctx.res.statusCode = 302
    ctx.res.setHeader('location', '/login?error=google')
    prependCookies(ctx.res, [clearStateCookie()])
    ctx.res.end()
    return
  }

  const code = ctx.query.get('code') ?? ''
  if (!code) {
    ctx.res.setHeader('set-cookie', clearStateCookie())
    throw httpError(400, 'missing authorization code')
  }

  const token = (await googleFetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${baseUrl()}/api/auth/google/callback`,
    }).toString(),
  })) as GoogleTokenResponse
  if (!token.access_token) {
    throw httpError(502, 'google sign-in is unavailable right now — please use email login')
  }

  const info = (await googleFetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${token.access_token}` },
  })) as GoogleUserInfo
  const sub = typeof info.sub === 'string' ? info.sub : ''
  const email = typeof info.email === 'string' ? info.email.trim().toLowerCase() : ''
  if (!sub || !isEmail(email) || info.email_verified === false) {
    throw httpError(502, 'google returned an unusable profile — please use email login')
  }

  const userId = findOrCreateGoogleUser(sub, email)

  startSession(ctx.res, userId) // stages the session cookie on res
  prependCookies(ctx.res, [clearStateCookie()])
  ctx.res.statusCode = 302
  ctx.res.setHeader('location', '/')
  ctx.res.end()
}

/**
 * Find-or-create by stable identity, then by email:
 *  1. (oauth_provider, oauth_sub) hit → returning Google user.
 *  2. email hit → link the Google identity to the existing account (no dupes).
 *  3. otherwise create a user: username = email local-part (sanitized to the
 *     contract username charset, deduped with a numeric suffix), unusable
 *     random password hash (the column is NOT NULL; email login stays
 *     impossible until/unless a password-reset flow exists).
 */
function findOrCreateGoogleUser(sub: string, email: string): number {
  const db = getDb()
  const bySub = db
    .prepare(`SELECT id FROM users WHERE oauth_provider = 'google' AND oauth_sub = ?`)
    .get(sub) as { id: number } | undefined
  if (bySub) return bySub.id

  const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: number }
    | undefined
  if (byEmail) {
    db.prepare(`UPDATE users SET oauth_provider = 'google', oauth_sub = ? WHERE id = ?`).run(
      sub,
      byEmail.id,
    )
    return byEmail.id
  }

  const username = uniqueUsername(email)
  try {
    const inserted = db
      .prepare(
        `INSERT INTO users (email, username, password_hash, oauth_provider, oauth_sub)
         VALUES (?, ?, ?, 'google', ?) RETURNING id`,
      )
      .get(email, username, hashPassword(randomBytes(24).toString('base64url')), sub) as {
      id: number
    }
    return inserted.id
  } catch {
    // Concurrent callback for the same identity raced us — re-read the winner.
    const winner = db
      .prepare(
        `SELECT id FROM users WHERE (oauth_provider = 'google' AND oauth_sub = ?) OR email = ?`,
      )
      .get(sub, email) as { id: number } | undefined
    if (winner) return winner.id
    throw httpError(502, 'could not create the account — please try again')
  }
}

/** email local-part → contract-valid unique username (numeric suffix dedupe). */
function uniqueUsername(email: string): string {
  const local = email.split('@')[0] ?? ''
  let base = local
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 26)
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(base)) base = 'user'
  const db = getDb()
  const taken = db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE')
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}${i + 1}`
    if (candidate.length > 30) break
    if (!taken.get(candidate)) return candidate
  }
  return `user${randomBytes(4).toString('hex')}` // 12 chars, charset-safe
}
