// Photos + events (CONTRACTS §6, PRODUCT_SPEC §6.8/6.15):
// dataUrl validation (MIME regex + magic bytes + size cap), event whitelist.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { api, cleanupTmp, freshDb, insertPlace, signupAndCookie, startServer } from './helpers.ts'
import type { TestServer } from './helpers.ts'

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

// ── Byte-level fixtures (P1-12 made the server parse structure, so test files
//    must be well-formed: valid segment/chunk framing, not just magic bytes) ──

/** JPEG segment: FF <marker> <u16 length incl. itself> <payload>. */
function jpegSeg(marker: number, payload: Buffer): Buffer {
  const b = Buffer.alloc(4 + payload.length)
  b[0] = 0xff
  b[1] = marker
  b.writeUInt16BE(payload.length + 2, 2)
  payload.copy(b, 4)
  return b
}

/** PNG chunk: <u32 length> <4-char type> <data> <crc> (CRC not validated). */
function pngChunk(type: string, data: Buffer): Buffer {
  const b = Buffer.alloc(12 + data.length)
  b.writeUInt32BE(data.length, 0)
  b.write(type, 4, 'latin1')
  data.copy(b, 8)
  b.writeUInt32BE(0xdeadbeef, 8 + data.length)
  return b
}

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])
const APP0_JFIF = jpegSeg(
  0xe0,
  Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
)
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const IHDR = pngChunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]))
const IEND = pngChunk('IEND', Buffer.alloc(0))

// Smallest well-formed JPEG: SOI + APP0(JFIF) + EOI. PNG: signature + IHDR + IEND.
const TINY_JPEG = Buffer.concat([SOI, APP0_JFIF, EOI])
const TINY_PNG = Buffer.concat([PNG_SIG, IHDR, IEND])
const toDataUrl = (mime: string, buf: Buffer): string => `data:${mime};base64,${buf.toString('base64')}`

describe('POST /api/photos (auth required — CRITICAL_REVIEW B2b)', () => {
  it('accepts a valid tiny JPEG → 201 + photo row + file on disk; PNG also OK', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'photo1@example.com', 'photo1', 'password-123')
    const res = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: place.id, dataUrl: toDataUrl('image/jpeg', TINY_JPEG), width: 4, height: 4 },
      cookie,
    })
    expect(res.status).toBe(201)
    expect(res.body?.url).toMatch(/^\/uploads\/[0-9a-f]{24}\.jpg$/)
    const row = db.prepare('SELECT * FROM photos WHERE place_id = ?').get(place.id) as any
    expect(row.url).toBe(res.body?.url)
    expect(row.width).toBe(4)
    const file = path.join(process.env.NERDE_UPLOAD_DIR!, path.basename(res.body!.url))
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    // Photo shows up on the place detail.
    const detail = await api(server.base, 'GET', `/api/places/${place.slug}`)
    expect(detail.body?.place.photos[0].url).toBe(res.body?.url)

    const png = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: place.id, dataUrl: toDataUrl('image/png', TINY_PNG) },
      cookie,
    })
    expect(png.status).toBe(201)
    expect(png.body?.url).toMatch(/\.png$/)
  })

  it('guest upload → 401 and no file is written (no anonymous image host)', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const res = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: place.id, dataUrl: toDataUrl('image/jpeg', TINY_JPEG) },
    })
    expect(res.status).toBe(401)
    expect((db.prepare('SELECT COUNT(*) AS c FROM photos').get() as any).c).toBe(0)
    const dir = process.env.NERDE_UPLOAD_DIR!
    expect(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0).toBe(true)
  })

  it('missing place_id → 400; unknown place_id → 404 — validated BEFORE writing, no orphan file', async () => {
    const cookie = await signupAndCookie(server.base, 'photo2@example.com', 'photo2', 'password-123')
    const missing = await api(server.base, 'POST', '/api/photos', {
      body: { dataUrl: toDataUrl('image/jpeg', TINY_JPEG) },
      cookie,
    })
    expect(missing.status).toBe(400)
    const unknown = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: 99999, dataUrl: toDataUrl('image/jpeg', TINY_JPEG) },
      cookie,
    })
    expect(unknown.status).toBe(404)
    // The orphan-file hole QA noted: nothing may hit the disk for rejected uploads.
    const dir = process.env.NERDE_UPLOAD_DIR!
    expect(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0).toBe(true)
  })

  it('rejects non-image data URLs (text/html, svg) with 400', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'photo3@example.com', 'photo3', 'password-123')
    for (const dataUrl of [
      toDataUrl('image/svg+xml', Buffer.from('<svg onload=alert(1)>')),
      toDataUrl('text/html', Buffer.from('<script>alert(1)</script>')),
      'https://evil.example/x.jpg',
      'not a data url',
    ]) {
      const res = await api(server.base, 'POST', '/api/photos', { body: { place_id: place.id, dataUrl }, cookie })
      expect(res.status).toBe(400)
    }
    expect((db.prepare('SELECT COUNT(*) AS c FROM photos').get() as any).c).toBe(0)
  })

  it('rejects MIME/content mismatch (declared jpeg but bytes are not) with 400', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'photo4@example.com', 'photo4', 'password-123')
    const res = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: place.id, dataUrl: toDataUrl('image/jpeg', Buffer.from('MZ this is an exe')) },
      cookie,
    })
    expect(res.status).toBe(400)
  })

  it('rejects images over 4 MB decoded with a 4xx (payload too large)', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'photo5@example.com', 'photo5', 'password-123')
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4 * 1024 * 1024 + 1, 0x00)])
    const res = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: place.id, dataUrl: toDataUrl('image/jpeg', big) },
      cookie,
    })
    expect([400, 413]).toContain(res.status) // server returns 413 (see TEST_PLAN §7)
    expect((db.prepare('SELECT COUNT(*) AS c FROM photos').get() as any).c).toBe(0)
  })
})

describe('POST /api/photos — server-side EXIF/privacy strip (P1-12, CRITICAL_REVIEW B2-iv)', () => {
  // A direct API upload bypasses the browser canvas re-encode, so the server
  // itself must drop metadata. These fixtures embed the ASCII marker string
  // "GPSLatitude" the way an Exif GPS IFD would.

  it('JPEG: APP1 Exif segment with GPS data is stripped; JFIF + SOI/EOI survive', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'exif1@example.com', 'exif1', 'password-123')
    const app1Exif = jpegSeg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('GPSLatitude 41.0 GPSLongitude 28.9', 'latin1')]))
    const app13 = jpegSeg(0xed, Buffer.from('Photoshop IPTC junk', 'latin1'))
    const com = jpegSeg(0xfe, Buffer.from('shot on my phone at home', 'latin1'))
    const withMeta = Buffer.concat([SOI, APP0_JFIF, app1Exif, app13, com, EOI])

    const res = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: place.id, dataUrl: toDataUrl('image/jpeg', withMeta) },
      cookie,
    })
    expect(res.status).toBe(201)
    const file = path.join(process.env.NERDE_UPLOAD_DIR!, path.basename(res.body!.url))
    const served = fs.readFileSync(file)
    expect(served.includes(Buffer.from('GPSLatitude', 'latin1'))).toBe(false)
    expect(served.includes(Buffer.from('IPTC', 'latin1'))).toBe(false)
    expect(served.includes(Buffer.from('shot on my phone', 'latin1'))).toBe(false)
    expect(served.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])) // SOI
    expect(served.subarray(-2)).toEqual(EOI) // EOI
    expect(served.includes(Buffer.from('JFIF', 'latin1'))).toBe(true) // APP0 kept
    expect(served).toEqual(TINY_JPEG) // exactly the metadata-free image
  })

  it('PNG: eXIf + tEXt chunks are dropped; IHDR/IEND kept byte-identical', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'exif2@example.com', 'exif2', 'password-123')
    const exif = pngChunk('eXIf', Buffer.from('GPSLatitude 41.0', 'latin1'))
    const text = pngChunk('tEXt', Buffer.from('Author\0home address', 'latin1'))
    const withMeta = Buffer.concat([PNG_SIG, IHDR, exif, text, IEND])

    const res = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: place.id, dataUrl: toDataUrl('image/png', withMeta) },
      cookie,
    })
    expect(res.status).toBe(201)
    const file = path.join(process.env.NERDE_UPLOAD_DIR!, path.basename(res.body!.url))
    const served = fs.readFileSync(file)
    expect(served.includes(Buffer.from('GPSLatitude', 'latin1'))).toBe(false)
    expect(served.includes(Buffer.from('eXIf', 'latin1'))).toBe(false)
    expect(served.includes(Buffer.from('home address', 'latin1'))).toBe(false)
    expect(served).toEqual(TINY_PNG) // signature + IHDR + IEND, untouched
  })

  it('a clean photo without metadata is stored byte-for-byte unchanged', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'exif3@example.com', 'exif3', 'password-123')
    const res = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: place.id, dataUrl: toDataUrl('image/jpeg', TINY_JPEG) },
      cookie,
    })
    expect(res.status).toBe(201)
    const file = path.join(process.env.NERDE_UPLOAD_DIR!, path.basename(res.body!.url))
    expect(fs.readFileSync(file)).toEqual(TINY_JPEG)
  })

  it('malformed structure → 400 fail-safe, nothing written to disk', async () => {
    const place = insertPlace(db, { lat: 10, lng: 10 })
    const cookie = await signupAndCookie(server.base, 'exif4@example.com', 'exif4', 'password-123')
    // APP1 announces 0x0020 bytes but the file ends immediately → truncated.
    const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x41, 0x42])
    const res = await api(server.base, 'POST', '/api/photos', {
      body: { place_id: place.id, dataUrl: toDataUrl('image/jpeg', truncated) },
      cookie,
    })
    expect(res.status).toBe(400)
    expect((db.prepare('SELECT COUNT(*) AS c FROM photos').get() as any).c).toBe(0)
    const dir = process.env.NERDE_UPLOAD_DIR!
    expect(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0).toBe(true)
  })
})

describe('POST /api/events (always 204)', () => {
  it('stores whitelisted types with client_id and meta', async () => {
    const res = await api(server.base, 'POST', '/api/events', {
      body: { type: 'place_viewed', client_id: 'anon-uuid-1', meta: { cat: 'calisthenics', place: 'x-y1z2' } },
    })
    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    const row = db.prepare('SELECT * FROM events').get() as any
    expect(row.type).toBe('place_viewed')
    expect(row.client_id).toBe('anon-uuid-1')
    expect(JSON.parse(row.meta)).toEqual({ cat: 'calisthenics', place: 'x-y1z2' })
    expect(row.user_id).toBeNull()
  })

  it('REGRESSION I2: stores client_id from the exact payload shape the client sends', async () => {
    // src/lib/events.ts track() posts { type, client_id, meta } with client_id
    // TOP-LEVEL (referrer_host inside meta on the first event of a session).
    const res = await api(server.base, 'POST', '/api/events', {
      body: {
        type: 'place_viewed',
        client_id: '9b2f4c1e-7a3d-4e5f-9c0b-1d2e3f4a5b6c',
        meta: { cat: 'vanlife', place: 'x-y1z2', referrer_host: 'google.com' },
      },
    })
    expect(res.status).toBe(204)
    const row = db.prepare('SELECT * FROM events').get() as any
    expect(row.client_id).toBe('9b2f4c1e-7a3d-4e5f-9c0b-1d2e3f4a5b6c')
    expect(JSON.parse(row.meta)).toEqual({ cat: 'vanlife', place: 'x-y1z2', referrer_host: 'google.com' })
  })

  it('legacy nested meta.client_id is accepted as a fallback and lifted out of meta', async () => {
    const res = await api(server.base, 'POST', '/api/events', {
      body: { type: 'near_me_used', meta: { client_id: 'legacy-nested-id', cat: 'sunset-spots' } },
    })
    expect(res.status).toBe(204)
    const row = db.prepare('SELECT * FROM events').get() as any
    expect(row.client_id).toBe('legacy-nested-id')
    // client_id is lifted to the column, not duplicated inside meta.
    expect(JSON.parse(row.meta)).toEqual({ cat: 'sunset-spots' })
  })

  it('unknown type → still 204, nothing stored; malformed body → still 204', async () => {
    const unknown = await api(server.base, 'POST', '/api/events', { body: { type: 'track_everything' } })
    expect(unknown.status).toBe(204)
    const malformed = await api(server.base, 'POST', '/api/events', {
      rawBody: 'this is not json',
      rawContentType: 'application/json',
    })
    expect(malformed.status).toBe(204)
    expect((db.prepare('SELECT COUNT(*) AS c FROM events').get() as any).c).toBe(0)
  })
})
