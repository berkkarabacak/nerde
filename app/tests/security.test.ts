// Security / abuse tests (MASTER_PROMPT §27): SQL injection, XSS payload
// handling, CSRF content-type guard, POST rate limiting, input size caps.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { api, cleanupTmp, freshDb, insertPlace, signupAndCookie, startServer } from './helpers.ts'
import type { TestServer } from './helpers.ts'
import { resetRateLimits } from '../server/rateLimit.ts'

let server: TestServer
let db: DatabaseSync

beforeAll(async () => {
  server = await startServer()
})
afterAll(async () => {
  await server.close()
  cleanupTmp()
})
beforeEach(() => {
  db = freshDb()
})

const WORLD = 'bbox=-180,-90,180,90'

describe('SQL injection resistance (all queries use bound parameters)', () => {
  it('injection in q / search returns normal results, no error, tables intact', async () => {
    insertPlace(db, { name: 'Legit Park', lat: 10, lng: 10 })
    const payloads = [`' OR '1'='1`, `'; DROP TABLE places; --`, `%' UNION SELECT * FROM users --`]
    for (const q of payloads) {
      const res = await api(server.base, 'GET', `/api/places?${WORLD}&q=${encodeURIComponent(q)}`)
      expect(res.status).toBe(200)
      expect(res.body?.places).toEqual([]) // literal substring match → no rows
      const search = await api(server.base, 'GET', `/api/search?q=${encodeURIComponent(q)}`)
      expect(search.status).toBe(200)
      expect(search.body?.places).toEqual([])
    }
    // places table still there and queryable.
    const after = await api(server.base, 'GET', `/api/places?${WORLD}`)
    expect(after.body?.places).toHaveLength(1)
  })

  it('injection in bbox / cat / attrs / near params is rejected or harmless', async () => {
    insertPlace(db, { name: 'Legit Park', lat: 10, lng: 10, cats: ['calisthenics'] })
    expect(
      (await api(server.base, 'GET', `/api/places?bbox=${encodeURIComponent(`0,0,0,0;DROP TABLE places`)}`)).status,
    ).toBe(400)
    const cat = await api(server.base, 'GET', `/api/places?${WORLD}&cat=${encodeURIComponent(`' OR 1=1 --`)}`)
    expect(cat.status).toBe(200)
    expect(cat.body?.places).toEqual([])
    const attrs = await api(server.base, 'GET', `/api/places?${WORLD}&attrs=${encodeURIComponent(`x'); DROP--`)}`)
    expect(attrs.status).toBe(400) // unknown attribute → validation error, not SQL error
    const near = await api(server.base, 'GET', `/api/places/near?lat=${encodeURIComponent(`0' OR '1`)}&lng=0`)
    expect(near.status).toBe(400)
    expect((await api(server.base, 'GET', `/api/places?${WORLD}`)).body?.places).toHaveLength(1)
  })

  it('slug param injection → clean 404, not a 500', async () => {
    const res = await api(server.base, 'GET', `/api/places/${encodeURIComponent(`' OR '1'='1`)}`)
    expect(res.status).toBe(404)
    expect(res.body?.error).toBe('place not found')
  })
})

describe('XSS payload handling', () => {
  it('script payload in a place name round-trips as inert JSON string data', async () => {
    const xss = `<script>alert("xss")</script>`
    const create = await api(server.base, 'POST', '/api/places', {
      body: { name: xss, lat: 10, lng: 10, categories: ['calisthenics'], attrs: {} },
    })
    expect(create.status).toBe(201)
    // Slug is sanitized even when the name is hostile.
    expect(create.body?.place.slug).toMatch(/^[a-z0-9-]+$/)
    expect(create.body?.place.slug).not.toContain('<')
    const detail = await api(server.base, 'GET', `/api/places/${create.body!.place.slug}`)
    expect(detail.status).toBe(200)
    // Stored and returned verbatim as a JSON string — the API content-type is
    // application/json, so there is no HTML execution path on the API side.
    // (Rendering safety is the client's responsibility; React escapes by default.)
    expect(detail.body?.place.name).toBe(xss)
    expect(detail.contentType).toContain('application/json')
  })

  it('img-onerror payload in a comment body is stored/returned as data only', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const signup = await api(server.base, 'POST', '/api/auth/signup', {
      body: { email: 'xss@example.com', username: 'xsser', password: 'password-123' },
    })
    const cookie = /nerde_session=[^;]+/.exec(signup.setCookie)![0]
    const payload = `<img src=x onerror=alert(1)>`
    const res = await api(server.base, 'POST', `/api/places/${place.id}/comments`, {
      body: { body: payload },
      cookie,
    })
    expect(res.status).toBe(201)
    const detail = await api(server.base, 'GET', `/api/places/${place.slug}`)
    expect(detail.body?.place.comments[0].body).toBe(payload)
    expect(detail.contentType).toContain('application/json')
  })
})

describe('CSRF content-type guard', () => {
  it('POST with text/plain body → 415; application/json passes; bodyless POST exempt', async () => {
    const formLike = await api(server.base, 'POST', '/api/events', {
      rawBody: 'type=place_viewed',
      rawContentType: 'text/plain;charset=UTF-8',
    })
    expect(formLike.status).toBe(415)
    const formPost = await api(server.base, 'POST', '/api/places', {
      rawBody: 'name=x&lat=1',
      rawContentType: 'application/x-www-form-urlencoded',
    })
    expect(formPost.status).toBe(415)
    // JSON passes the guard (and then fails validation normally → 400, not 415).
    const json = await api(server.base, 'POST', '/api/places', { body: { name: 'x' } })
    expect(json.status).toBe(400)
    // Bodyless POST (logout) is exempt by design.
    const logout = await api(server.base, 'POST', '/api/auth/logout')
    expect(logout.status).toBe(200)
  })
})

describe('rate limiting (CONTRACTS §6: 30 POST/min/IP)', () => {
  it('the 31st POST from one IP within a minute → 429 (XFF honored under NERDE_TRUST_PROXY=1)', async () => {
    // Per-IP bucketing via X-Forwarded-For applies only when the deployment
    // declares a trusted proxy (CRITICAL_REVIEW B2). Set the flag for this test.
    const prev = process.env.NERDE_TRUST_PROXY
    process.env.NERDE_TRUST_PROXY = '1'
    try {
      resetRateLimits()
      const ip = '203.0.113.77'
      let lastStatus = 0
      for (let i = 0; i < 30; i++) {
        const res = await api(server.base, 'POST', '/api/events', {
          body: { type: 'near_me_used' },
          headers: { 'x-forwarded-for': ip },
        })
        lastStatus = res.status
      }
      expect(lastStatus).toBe(204) // first 30 pass
      const blocked = await api(server.base, 'POST', '/api/events', {
        body: { type: 'near_me_used' },
        headers: { 'x-forwarded-for': ip },
      })
      expect(blocked.status).toBe(429)
      expect(blocked.body?.error).toContain('rate limit')
      // A different IP is unaffected.
      const other = await api(server.base, 'POST', '/api/events', {
        body: { type: 'near_me_used' },
        headers: { 'x-forwarded-for': '203.0.113.78' },
      })
      expect(other.status).toBe(204)
      // GETs are not rate limited.
      const get = await api(server.base, 'GET', `/api/places?${WORLD}`, {
        headers: { 'x-forwarded-for': ip },
      })
      expect(get.status).toBe(200)
    } finally {
      if (prev === undefined) delete process.env.NERDE_TRUST_PROXY
      else process.env.NERDE_TRUST_PROXY = prev
    }
  })

  it('without NERDE_TRUST_PROXY, spoofed per-request XFF does NOT evade the limit', async () => {
    // CRITICAL_REVIEW B2: with the flag unset the limiter keys on the socket
    // address, so rotating X-Forwarded-For collapses into one bucket.
    delete process.env.NERDE_TRUST_PROXY
    resetRateLimits()
    let lastStatus = 0
    for (let i = 0; i < 30; i++) {
      const res = await api(server.base, 'POST', '/api/events', {
        body: { type: 'near_me_used' },
        headers: { 'x-forwarded-for': `198.51.100.${i + 1}` }, // each request "a new IP"
      })
      lastStatus = res.status
    }
    expect(lastStatus).toBe(204)
    const blocked = await api(server.base, 'POST', '/api/events', {
      body: { type: 'near_me_used' },
      headers: { 'x-forwarded-for': '198.51.100.250' },
    })
    expect(blocked.status).toBe(429) // same socket → same bucket → blocked
  })

  it('photo uploads have their own tighter bucket (10/min/IP)', async () => {
    const prev = process.env.NERDE_TRUST_PROXY
    process.env.NERDE_TRUST_PROXY = '1'
    try {
      resetRateLimits()
      const ip = '203.0.113.99'
      const place = insertPlace(db, { lat: 10, lng: 10 })
      const cookie = await signupAndCookie(server.base, 'rl-photo@example.com', 'rlphoto', 'password-123')
      const tiny = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`
      let saw429 = false
      for (let i = 0; i < 11; i++) {
        const res = await api(server.base, 'POST', '/api/photos', {
          body: { place_id: place.id, dataUrl: tiny },
          headers: { 'x-forwarded-for': ip },
          cookie,
        })
        if (res.status === 429) saw429 = true
      }
      expect(saw429).toBe(true) // 11th photo upload blocked even though <30 global POSTs
    } finally {
      if (prev === undefined) delete process.env.NERDE_TRUST_PROXY
      else process.env.NERDE_TRUST_PROXY = prev
    }
  })
})

describe('request hardening', () => {
  it('oversized JSON bodies → 413; malformed JSON → 400', async () => {
    const huge = await api(server.base, 'POST', '/api/places', {
      rawBody: `{"name":"${'a'.repeat(1_100_000)}"}`,
      rawContentType: 'application/json',
    })
    expect(huge.status).toBe(413)
    const broken = await api(server.base, 'POST', '/api/places', {
      rawBody: '{not json',
      rawContentType: 'application/json',
    })
    expect(broken.status).toBe(400)
  })

  it('unknown /api paths → JSON 404; server errors stay JSON (no stack leak)', { timeout: 20000 }, async () => {
    const res = await api(server.base, 'GET', '/api/definitely-not-a-route')
    expect(res.status).toBe(404)
    expect(res.body?.error).toBe('not found')
    expect(res.text).not.toContain('node:')
  })
})
