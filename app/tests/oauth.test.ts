// Google OAuth login tests (MVP_BACKLOG P1-01). All Google traffic is stubbed
// via vi.stubGlobal('fetch', …) with pass-through to the real fetch — no live
// Google calls. Env vars are set/cleared per test because the handlers read
// process.env at request time.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupTmp, freshDb, insertUser, sessionCookie, startServer } from './helpers.ts'
import type { TestServer } from './helpers.ts'
import { getDb } from '../server/db.ts'

let server: TestServer

beforeAll(async () => {
  server = await startServer()
})
afterAll(async () => {
  await server.close()
  cleanupTmp()
})
beforeEach(() => {
  freshDb()
  clearGoogleEnv()
})
afterEach(() => {
  clearGoogleEnv()
  vi.unstubAllGlobals()
})

function clearGoogleEnv(): void {
  delete process.env.NERDE_GOOGLE_CLIENT_ID
  delete process.env.NERDE_GOOGLE_CLIENT_SECRET
  delete process.env.NERDE_BASE_URL
}

function setGoogleEnv(): void {
  process.env.NERDE_GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
  process.env.NERDE_GOOGLE_CLIENT_SECRET = 'test-client-secret'
}

/** GET that does NOT follow redirects (302 assertions need manual mode). */
async function getNoRedirect(
  path: string,
  cookie?: string,
): Promise<{ status: number; location: string; setCookie: string; text: string }> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  const res = await fetch(server.base + path, { redirect: 'manual', headers })
  return {
    status: res.status,
    location: res.headers.get('location') ?? '',
    setCookie: res.headers.get('set-cookie') ?? '',
    text: await res.text(),
  }
}

function oauthStateCookie(setCookie: string): string {
  const match = /nerde_oauth_state=[^;]+/.exec(setCookie)
  if (!match) throw new Error(`no nerde_oauth_state in set-cookie: ${setCookie}`)
  return match[0]
}

/** Stub Google endpoints; everything else (the test server) passes through. */
function stubGoogle(userinfo: Record<string, unknown> | null, tokenStatus = 200): void {
  const realFetch = globalThis.fetch.bind(globalThis)
  vi.stubGlobal('fetch', async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.startsWith('https://oauth2.googleapis.com/')) {
      if (tokenStatus !== 200) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: tokenStatus })
      }
      return new Response(
        JSON.stringify({ access_token: 'ya29.fake-token', token_type: 'Bearer', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.startsWith('https://openidconnect.googleapis.com/')) {
      return new Response(JSON.stringify(userinfo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return realFetch(input as RequestInfo, init as RequestInit)
  })
}

describe('GET /api/auth/providers', () => {
  it('reports google:false when env vars are missing', async () => {
    const res = await fetch(`${server.base}/api/auth/providers`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ google: false })
  })

  it('reports google:true only when BOTH env vars are set', async () => {
    process.env.NERDE_GOOGLE_CLIENT_ID = 'id-only'
    let res = await fetch(`${server.base}/api/auth/providers`)
    expect(await res.json()).toEqual({ google: false })

    clearGoogleEnv()
    process.env.NERDE_GOOGLE_CLIENT_SECRET = 'secret-only'
    res = await fetch(`${server.base}/api/auth/providers`)
    expect(await res.json()).toEqual({ google: false })

    setGoogleEnv()
    res = await fetch(`${server.base}/api/auth/providers`)
    expect(await res.json()).toEqual({ google: true })
  })
})

describe('GET /api/auth/google', () => {
  it('404s when Google login is not configured', async () => {
    const res = await getNoRedirect('/api/auth/google')
    expect(res.status).toBe(404)
  })

  it('302s to Google consent with client_id, redirect_uri, scope and a state cookie', async () => {
    setGoogleEnv()
    const res = await getNoRedirect('/api/auth/google')
    expect(res.status).toBe(302)

    const location = new URL(res.location)
    expect(`${location.origin}${location.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com')
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:7100/api/auth/google/callback')
    expect(location.searchParams.get('response_type')).toBe('code')
    expect(location.searchParams.get('scope')).toBe('openid email profile')
    const state = location.searchParams.get('state')
    expect(state).toMatch(/^[0-9a-f]{32}$/)

    // State is mirrored into a short-lived httpOnly SameSite=Lax cookie.
    expect(res.setCookie).toContain(`nerde_oauth_state=${state}`)
    expect(res.setCookie).toContain('HttpOnly')
    expect(res.setCookie).toContain('SameSite=Lax')
    expect(res.setCookie).toContain('Max-Age=600')
  })

  it('uses NERDE_BASE_URL for the redirect_uri when set', async () => {
    setGoogleEnv()
    process.env.NERDE_BASE_URL = 'https://staging.nerde.example/'
    const res = await getNoRedirect('/api/auth/google')
    const location = new URL(res.location)
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://staging.nerde.example/api/auth/google/callback',
    )
  })
})

describe('GET /api/auth/google/callback', () => {
  it('400s when the state cookie is missing or mismatched (and clears the cookie)', async () => {
    setGoogleEnv()
    const missing = await getNoRedirect('/api/auth/google/callback?state=abc&code=x')
    expect(missing.status).toBe(400)
    expect(missing.setCookie).toContain('nerde_oauth_state=')
    expect(missing.setCookie).toContain('Max-Age=0')

    const start = await getNoRedirect('/api/auth/google')
    const state = new URL(start.location).searchParams.get('state')!
    const mismatch = await getNoRedirect(
      `/api/auth/google/callback?state=${state}-tampered&code=x`,
      oauthStateCookie(start.setCookie),
    )
    expect(mismatch.status).toBe(400)
    expect(JSON.parse(mismatch.text).error).toContain('state')
  })

  it('400s when the code is missing', async () => {
    setGoogleEnv()
    const start = await getNoRedirect('/api/auth/google')
    const state = new URL(start.location).searchParams.get('state')!
    const res = await getNoRedirect(
      `/api/auth/google/callback?state=${state}`,
      oauthStateCookie(start.setCookie),
    )
    expect(res.status).toBe(400)
  })

  it('happy path: creates a user, sets a session, 302s to / (stubbed Google)', async () => {
    setGoogleEnv()
    stubGoogle({ sub: 'g-123', email: 'Grace.Hopper@Example.com', email_verified: true, name: 'Grace' })

    const start = await getNoRedirect('/api/auth/google')
    const state = new URL(start.location).searchParams.get('state')!
    const cb = await getNoRedirect(
      `/api/auth/google/callback?state=${state}&code=fake-code`,
      oauthStateCookie(start.setCookie),
    )
    expect(cb.status).toBe(302)
    expect(cb.location).toBe('/')
    expect(cb.setCookie).toContain('nerde_session=')
    expect(cb.setCookie).toContain('Max-Age=0') // one-shot state cookie cleared

    // Session works; email lowercased; username = local-part; oauth link stored.
    const cookie = sessionCookie(cb.setCookie)
    const me = await fetch(`${server.base}/api/auth/me`, { headers: { cookie } })
    expect((await me.json()).user).toMatchObject({ username: 'grace_hopper', role: 'user' })
    const row = getDb()
      .prepare(`SELECT email, username, oauth_provider, oauth_sub FROM users WHERE email = ?`)
      .get('grace.hopper@example.com') as Record<string, string>
    expect(row).toMatchObject({ username: 'grace_hopper', oauth_provider: 'google', oauth_sub: 'g-123' })
  })

  it('links to the existing account when the email matches (no duplicate user)', async () => {
    setGoogleEnv()
    const existing = insertUser(getDb(), 'user', { email: 'ada@example.com', username: 'ada' })
    stubGoogle({ sub: 'g-999', email: 'ada@example.com', email_verified: true })

    const start = await getNoRedirect('/api/auth/google')
    const state = new URL(start.location).searchParams.get('state')!
    const cb = await getNoRedirect(
      `/api/auth/google/callback?state=${state}&code=fake-code`,
      oauthStateCookie(start.setCookie),
    )
    expect(cb.status).toBe(302)

    const count = getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
    expect(count.c).toBe(1) // linked, not duplicated
    const row = getDb().prepare('SELECT id, username, oauth_sub FROM users').get() as {
      id: number
      username: string
      oauth_sub: string
    }
    expect(row).toMatchObject({ id: existing.id, username: 'ada', oauth_sub: 'g-999' })
    const me = await fetch(`${server.base}/api/auth/me`, {
      headers: { cookie: sessionCookie(cb.setCookie) },
    })
    expect((await me.json()).user).toMatchObject({ id: existing.id, username: 'ada' })
  })

  it('dedupes usernames with a numeric suffix when the local-part is taken', async () => {
    setGoogleEnv()
    insertUser(getDb(), 'user', { email: 'taken@example.com', username: 'sam' })
    stubGoogle({ sub: 'g-321', email: 'sam@other.example', email_verified: true })

    const start = await getNoRedirect('/api/auth/google')
    const state = new URL(start.location).searchParams.get('state')!
    await getNoRedirect(`/api/auth/google/callback?state=${state}&code=fake-code`, oauthStateCookie(start.setCookie))
    const row = getDb().prepare(`SELECT username FROM users WHERE oauth_sub = 'g-321'`).get() as {
      username: string
    }
    expect(row.username).toBe('sam2')
  })

  it('502s with clean JSON when the token exchange fails', async () => {
    setGoogleEnv()
    stubGoogle(null, 400)
    const start = await getNoRedirect('/api/auth/google')
    const state = new URL(start.location).searchParams.get('state')!
    const res = await getNoRedirect(
      `/api/auth/google/callback?state=${state}&code=bad-code`,
      oauthStateCookie(start.setCookie),
    )
    expect(res.status).toBe(502)
    expect(JSON.parse(res.text).error).toContain('google')
  })
})
