// Input validation + small parsing helpers for the Nerde API.
// Every validator throws HttpError (4xx) on bad input; route handlers stay clean.
import type { IncomingMessage } from 'node:http'
import { httpError } from './http.ts'

/** Read and parse a JSON request body with a hard size cap. Empty body → {}. */
export async function readJson(req: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > maxBytes) throw httpError(413, 'request body too large')
    chunks.push(buf)
  }
  if (size === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError(400, 'invalid JSON body')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw httpError(400, 'JSON body must be an object')
  }
  return parsed
}

/** Trim a value to a bounded string; non-strings → ''. */
export function asTrimmed(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLen)
}

/** Required string field with length bounds. */
export function requireString(
  obj: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): string {
  const v = asTrimmed(obj[field], max + 1)
  if (v.length < min) throw httpError(400, `${field} is required (min ${min} chars)`)
  if (v.length > max) throw httpError(400, `${field} must be at most ${max} chars`)
  return v
}

/** Optional string field with a length bound ('' → defaultValue). */
export function optString(
  obj: Record<string, unknown>,
  field: string,
  max: number,
  defaultValue = '',
): string {
  const raw = obj[field]
  if (raw === undefined || raw === null) return defaultValue
  const v = asTrimmed(raw, max + 1)
  if (v.length > max) throw httpError(400, `${field} must be at most ${max} chars`)
  return v
}

/** Parse a finite number from a query/body value; null when absent/invalid. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Required numeric field with range validation. */
export function requireNumber(
  obj: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const n = asNumber(obj[field])
  if (n === null) throw httpError(400, `${field} must be a number`)
  if (n < min || n > max) throw httpError(400, `${field} must be between ${min} and ${max}`)
  return n
}

/** Integer query param with clamp + fallback (used for limit/radius params). */
export function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  const n = asNumber(value)
  if (n === null) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/** Float query param with clamp + fallback. */
export function clampFloat(value: string | null, min: number, max: number, fallback: number): number {
  const n = asNumber(value)
  if (n === null) return fallback
  return Math.max(min, Math.min(max, n))
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value)
}

const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/

export function isUsername(value: string): boolean {
  return USERNAME_RE.test(value)
}

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isKebabSlug(value: string): boolean {
  return value.length >= 2 && value.length <= 60 && KEBAB_RE.test(value)
}

/**
 * URL slug: lowercase, strip diacritics, non-alphanumerics → '-', collapse,
 * trim, cap at 60 chars. Falls back to 'place' when nothing usable remains.
 */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics (ş→s, ı→i handled below)
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '')
  return s || 'place'
}

/** Escape the LIKE wildcards %, _ and the escape char itself (use with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/** Parse the Cookie header into a plain map. */
export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    if (key) out[key] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

/**
 * Best-effort client IP for rate limiting. Defaults to the socket address;
 * X-Forwarded-For is honored ONLY when NERDE_TRUST_PROXY=1 (i.e. the server
 * demonstrably sits behind a real reverse proxy). serve.ts listens directly,
 * so with the flag unset a client can spoof XFF per request and the limiter
 * would never trip (CRITICAL_REVIEW B2). Read per-call so tests can toggle.
 */
export function clientIp(req: IncomingMessage): string {
  if (process.env.NERDE_TRUST_PROXY === '1') {
    const fwd = req.headers['x-forwarded-for']
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim()
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** Normalize a place name for duplicate detection (DATABASE.md §5.3 step 2). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Classic Levenshtein distance (names are ≤80 chars, candidate sets are tiny). */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/**
 * Name-similarity rule for duplicate detection: after normalization, accept
 * when one contains the other (≥3 chars) or edit-distance similarity ≥ 0.6.
 */
export function namesSimilar(a: string, b: string): boolean {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  if (shorter.length >= 3 && longer.includes(shorter)) return true
  const similarity = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length)
  return similarity >= 0.6
}

/** XML-escape text nodes/attribute values for sitemap output. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** node:sqlite cannot bind booleans — coerce to 0/1. */
export function bool01(value: boolean): 0 | 1 {
  return value ? 1 : 0
}
