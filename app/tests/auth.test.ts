// Auth tests (CONTRACTS §6, PRODUCT_SPEC §6.9): signup → me → login → logout,
// duplicate 409s, generic 401 on bad credentials, scrypt verify paths.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { api, cleanupTmp, freshDb, sessionCookie, startServer } from './helpers.ts'
import type { TestServer } from './helpers.ts'
import { hashPassword, verifyPassword } from '../server/auth.ts'

let server: TestServer

beforeAll(async () => {
  server = await startServer()
})
afterAll(async () => {
  await server.close()
  cleanupTmp()
})
beforeEach(() => freshDb())

describe('auth API', () => {
  it('signup → 201, sets httpOnly SameSite=Lax cookie, /me returns the user', async () => {
    const res = await api(server.base, 'POST', '/api/auth/signup', {
      body: { email: 'Ada@Example.com', username: 'ada_lovelace', password: 'correct horse 9' },
    })
    expect(res.status).toBe(201)
    expect(res.body?.user).toMatchObject({ username: 'ada_lovelace', role: 'user' })
    expect(res.setCookie).toContain('nerde_session=')
    expect(res.setCookie).toContain('HttpOnly')
    expect(res.setCookie).toContain('SameSite=Lax')
    expect(res.setCookie).toContain('Max-Age=2592000') // 30 days

    const me = await api(server.base, 'GET', '/api/auth/me', { cookie: sessionCookie(res.setCookie) })
    expect(me.status).toBe(200)
    expect(me.body?.user).toMatchObject({ username: 'ada_lovelace', role: 'user' })
    expect(me.body?.user).not.toHaveProperty('email') // no PII leak in /me shape
  })

  it('login with wrong password → generic 401 (no user enumeration)', async () => {
    await api(server.base, 'POST', '/api/auth/signup', {
      body: { email: 'bob@example.com', username: 'bobby', password: 'password-123' },
    })
    const bad = await api(server.base, 'POST', '/api/auth/login', {
      body: { email: 'bob@example.com', password: 'wrong-password' },
    })
    expect(bad.status).toBe(401)
    expect(bad.body?.error).toBe('invalid email or password')
    // Unknown account gets the same generic message.
    const unknown = await api(server.base, 'POST', '/api/auth/login', {
      body: { email: 'nobody@example.com', password: 'password-123' },
    })
    expect(unknown.status).toBe(401)
    expect(unknown.body?.error).toBe('invalid email or password')
  })

  it('login with correct password → 200 + fresh session cookie', async () => {
    await api(server.base, 'POST', '/api/auth/signup', {
      body: { email: 'carol@example.com', username: 'carol', password: 'password-123' },
    })
    const login = await api(server.base, 'POST', '/api/auth/login', {
      body: { email: 'CAROL@example.com', password: 'password-123' }, // email is case-insensitive
    })
    expect(login.status).toBe(200)
    expect(login.body?.user?.username).toBe('carol')
    const me = await api(server.base, 'GET', '/api/auth/me', { cookie: sessionCookie(login.setCookie) })
    expect(me.body?.user?.username).toBe('carol')
  })

  it('duplicate email → 409; duplicate username (case-insensitive) → 409', async () => {
    const first = await api(server.base, 'POST', '/api/auth/signup', {
      body: { email: 'dan@example.com', username: 'danny', password: 'password-123' },
    })
    expect(first.status).toBe(201)
    const dupeEmail = await api(server.base, 'POST', '/api/auth/signup', {
      body: { email: 'DAN@example.com', username: 'other', password: 'password-123' },
    })
    expect(dupeEmail.status).toBe(409)
    const dupeName = await api(server.base, 'POST', '/api/auth/signup', {
      body: { email: 'other@example.com', username: 'DANNY', password: 'password-123' },
    })
    expect(dupeName.status).toBe(409)
  })

  it('rejects invalid signup payloads with 400', async () => {
    for (const body of [
      { email: 'not-an-email', username: 'validname', password: 'password-123' },
      { email: 'e@example.com', username: 'x', password: 'password-123' }, // username too short
      { email: 'e@example.com', username: 'bad name!', password: 'password-123' },
      { email: 'e@example.com', username: 'validname', password: 'short' }, // password < 8
    ]) {
      const res = await api(server.base, 'POST', '/api/auth/signup', { body })
      expect(res.status).toBe(400)
    }
  })

  it('logout revokes the session row and expires the cookie', async () => {
    const signup = await api(server.base, 'POST', '/api/auth/signup', {
      body: { email: 'erin@example.com', username: 'erin', password: 'password-123' },
    })
    const cookie = sessionCookie(signup.setCookie)
    const out = await api(server.base, 'POST', '/api/auth/logout', { cookie })
    expect(out.status).toBe(200)
    expect(out.setCookie).toContain('Max-Age=0')
    const me = await api(server.base, 'GET', '/api/auth/me', { cookie })
    expect(me.body?.user).toBeNull() // server-side session is gone, not just the cookie
  })

  it('GET /api/auth/me without a cookie → {user:null}', async () => {
    const me = await api(server.base, 'GET', '/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body?.user).toBeNull()
  })
})

describe('scrypt password hashing', () => {
  it('hash → verify round-trip; wrong password rejected', () => {
    const hash = hashPassword('hunter2-secret')
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(verifyPassword('hunter2-secret', hash)).toBe(true)
    expect(verifyPassword('hunter3-secret', hash)).toBe(false)
  })

  it('verify is format-tolerant and timing-safe (no throw on malformed stored hashes)', () => {
    expect(verifyPassword('x', '')).toBe(false)
    expect(verifyPassword('x', 'scrypt$bad')).toBe(false)
    expect(verifyPassword('x', 'scrypt$16384$8$1$zz$00')).toBe(false)
    expect(verifyPassword('x', 'bcrypt$16384$8$1$aaaa$bbbb')).toBe(false)
    // A flipped bit in the stored hash must fail the timing-safe comparison.
    const hash = hashPassword('hunter2-secret')
    const tampered = hash.slice(0, -1) + (hash.endsWith('0') ? '1' : '0')
    expect(verifyPassword('hunter2-secret', tampered)).toBe(false)
  })

  it('salts are random — two hashes of one password differ', () => {
    expect(hashPassword('same-password')).not.toBe(hashPassword('same-password'))
  })
})
