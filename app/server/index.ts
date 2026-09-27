// Nerde API entry — mounted by vite.config.ts (dev) and server/serve.ts (prod).
// Small router that delegates to route handlers. NO top-level side effects:
// the database opens lazily on the first query (server/db.ts), so importing
// this module is always safe.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getSessionUser, login, logout, me, signup } from './auth.ts'
import { authProviders, googleCallback, googleStart } from './oauth.ts'
import { HttpError, httpError, json } from './http.ts'
import type { Ctx } from './http.ts'
import { consumeRateLimit } from './rateLimit.ts'
import { listCategories } from './routes/categories.ts'
import {
  addComment,
  reportPlace,
  savePlace,
  unsavePlace,
  verifyPlace,
} from './routes/community.ts'
import { trackEvent } from './routes/events.ts'
import { myPlaces, mySaved } from './routes/me.ts'
import { uploadPhoto } from './routes/photos.ts'
import { createPlace, getPlace, listPlaces, nearPlaces } from './routes/places.ts'
import { search } from './routes/search.ts'
import {
  adminCreateCategory,
  adminEditPlace,
  adminFunnel,
  adminPlaceAction,
  adminReports,
  adminStats,
  adminUpdateCategory,
  adminUpdateReport,
} from './routes/admin.ts'
import { robots, sitemap } from './routes/seo.ts'

type Handler = (ctx: Ctx) => void | Promise<void>

interface Route {
  method: string
  segments: string[]
  handler: Handler
}

const routes: Route[] = []

function on(method: string, pattern: string, handler: Handler): void {
  routes.push({ method, segments: pattern.split('/').filter(Boolean), handler })
}

// ── Route table (CONTRACTS §6). Specific paths before `:param` patterns —
// first match wins (e.g. /api/places/near before /api/places/:slug). ──────────

on('GET', '/api/health', (ctx) => json(ctx.res, 200, { ok: true }))
on('GET', '/api/categories', listCategories)
on('GET', '/api/places', listPlaces)
on('GET', '/api/places/near', nearPlaces)
on('GET', '/api/places/:slug', getPlace)
on('POST', '/api/places', createPlace)
on('POST', '/api/photos', uploadPhoto)
on('GET', '/api/search', search)
on('POST', '/api/places/:id/verify', verifyPlace)
on('POST', '/api/places/:id/comments', addComment)
on('POST', '/api/places/:id/report', reportPlace)
on('POST', '/api/places/:id/save', savePlace)
on('DELETE', '/api/places/:id/save', unsavePlace)
on('POST', '/api/events', trackEvent)
on('POST', '/api/auth/signup', signup)
on('POST', '/api/auth/login', login)
on('POST', '/api/auth/logout', logout)
on('GET', '/api/auth/me', me)
// Google OAuth (MVP_BACKLOG P1-01) — env-gated; 404s when unconfigured.
on('GET', '/api/auth/providers', authProviders)
on('GET', '/api/auth/google', googleStart)
on('GET', '/api/auth/google/callback', googleCallback)
on('GET', '/api/me/saved', mySaved)
on('GET', '/api/me/places', myPlaces)
on('GET', '/api/admin/reports', adminReports)
on('POST', '/api/admin/reports/:id', adminUpdateReport)
on('POST', '/api/admin/places/:id', adminPlaceAction)
on('PUT', '/api/admin/places/:id', adminEditPlace)
on('POST', '/api/admin/categories', adminCreateCategory)
on('PUT', '/api/admin/categories/:id', adminUpdateCategory)
on('GET', '/api/admin/stats', adminStats)
on('GET', '/api/admin/funnel', adminFunnel)
// SEO infra lives outside /api (same middleware, CONTRACTS §6).
on('GET', '/sitemap.xml', sitemap)
on('GET', '/robots.txt', robots)

function matchRoute(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  const pathSegments = path.split('/').filter(Boolean)
  for (const route of routes) {
    if (route.method !== method) continue
    if (route.segments.length !== pathSegments.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < route.segments.length; i++) {
      const seg = route.segments[i]
      if (seg.startsWith(':')) {
        let value = pathSegments[i]
        try {
          value = decodeURIComponent(value)
        } catch {
          // leave undecodable segments as-is
        }
        params[seg.slice(1)] = value
      } else if (seg !== pathSegments[i]) {
        ok = false
        break
      }
    }
    if (ok) return { handler: route.handler, params }
  }
  return null
}

/**
 * CSRF mitigation (contract): mutating endpoints require
 * `content-type: application/json`. HTML forms cannot send that content type
 * cross-origin, so this blocks classic form CSRF. Requests WITHOUT a body
 * (logout, save/unsave toggles) are exempt — a cross-site form always carries
 * a body, so bodyless requests have no form-CSRF vector.
 */
function csrfGuard(req: IncomingMessage): void {
  const method = req.method ?? 'GET'
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return
  const length = Number(req.headers['content-length'] ?? 0)
  const hasBody = length > 0 || req.headers['transfer-encoding'] !== undefined
  if (!hasBody) return
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.includes('application/json')) {
    throw httpError(415, 'mutating requests require content-type application/json')
  }
}

/** Rate limits (CONTRACTS §6): all POST endpoints 30/min/IP; photos 10/min/IP. */
function rateLimitGuard(req: IncomingMessage, path: string): void {
  if (req.method !== 'POST' || !path.startsWith('/api/')) return
  if (!consumeRateLimit(req, 'post', 30)) {
    throw httpError(429, 'rate limit exceeded — try again in a minute')
  }
  if (path === '/api/photos' && !consumeRateLimit(req, 'photos', 10)) {
    throw httpError(429, 'photo upload rate limit exceeded — try again in a minute')
  }
}

/**
 * Handle one request. Returns true when the request was answered (any /api/*
 * path plus /sitemap.xml and /robots.txt), false so the caller falls through
 * to static/SPA handling.
 */
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  if (!path.startsWith('/api/') && path !== '/sitemap.xml' && path !== '/robots.txt') return false

  try {
    csrfGuard(req)
    rateLimitGuard(req, path)
    const match = matchRoute(req.method ?? 'GET', path)
    if (!match) {
      // Unknown /api path → JSON 404; unknown sitemap/robots method → 405.
      if (path.startsWith('/api/')) throw httpError(404, 'not found')
      throw httpError(405, 'method not allowed')
    }
    const ctx: Ctx = {
      req,
      res,
      method: req.method ?? 'GET',
      path,
      params: match.params,
      query: url.searchParams,
      user: getSessionUser(req),
    }
    await match.handler(ctx)
  } catch (err) {
    if (res.writableEnded) throw err
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.message, ...(err.extra ?? {}) })
    } else {
      console.error('[nerde-api]', err)
      json(res, 500, { error: 'internal server error' })
    }
  }
  return true
}
