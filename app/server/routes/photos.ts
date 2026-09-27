// POST /api/photos — base64 dataUrl upload (AUTH REQUIRED, contract amendment
// after CRITICAL_REVIEW B2: an open endpoint made Nerde a free anonymous image
// host; anonymous PLACE creation stays open and is moderated via reports — a
// deliberate friction tradeoff recorded in CONTRACTS.md Amendments).
// Requires a valid existing place_id, and EVERYTHING is validated before any
// byte hits the disk (no orphan files). JPEG/PNG only, verified by magic bytes
// (never trust the declared MIME), ≤4 MB decoded, written to NERDE_UPLOAD_DIR
// under a random name.
//
// PRIVACY STRIP (P1-12, CRITICAL_REVIEW B2-iv): after magic-byte validation
// and BEFORE writing, all metadata segments/chunks (JPEG APP1 Exif+XMP /
// APP13 / COM; PNG eXIf + tEXt/iTXt/zTXt) are removed server-side — the
// browser canvas re-encode only covers honest browsers; a direct API upload
// would otherwise keep full EXIF incl. GPS. Structurally malformed files are
// rejected 400 (fail safe) rather than stored unstripped.
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { envPath, getDb } from '../db.ts'
import { httpError, json } from '../http.ts'
import type { Ctx } from '../http.ts'
import { SanitizeError, stripJpegMetadata, stripPngMetadata } from '../imageSanitize.ts'
import { getPlaceById } from '../placeData.ts'
import { asNumber, readJson } from '../validate.ts'

const MAX_DECODED_BYTES = 4 * 1024 * 1024 // 4 MB after client-side resize
const DATA_URL_RE = /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/=\r\n]+)$/

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export async function uploadPhoto(ctx: Ctx): Promise<void> {
  // Photos get their own bucket (10/min/IP) on top of the global POST bucket,
  // enforced in the router.

  // 1) Auth gate — photos are attached to real places by real accounts.
  if (!ctx.user) throw httpError(401, 'log in to upload photos')

  // 2) Place gate — a photo must belong to an existing place; reject BEFORE
  //    decoding/writing so a rejected upload never leaves an orphan file.
  const body = (await readJson(ctx.req, 8_000_000)) as Record<string, unknown>
  const placeId = asNumber(body.place_id)
  if (placeId === null) throw httpError(400, 'place_id is required')
  const place = getPlaceById(placeId)
  if (!place) throw httpError(404, 'place not found')

  // 3) Payload validation (declared MIME, size cap, magic bytes).
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : ''
  const match = DATA_URL_RE.exec(dataUrl)
  if (!match) throw httpError(400, 'dataUrl must be a base64 data:image/jpeg or data:image/png URL')

  const declared = match[1]
  const buf = Buffer.from(match[2], 'base64')
  if (buf.length === 0) throw httpError(400, 'empty image data')
  if (buf.length > MAX_DECODED_BYTES) throw httpError(413, 'image too large (max 4 MB)')

  const isJpeg = buf.subarray(0, 3).equals(JPEG_MAGIC)
  const isPng = buf.subarray(0, 8).equals(PNG_MAGIC)
  if (declared === 'image/jpeg' && !isJpeg) throw httpError(400, 'file content is not a JPEG')
  if (declared === 'image/png' && !isPng) throw httpError(400, 'file content is not a PNG')

  // 4) Privacy strip (P1-12): drop EXIF/XMP/IPTC/comment metadata incl. GPS.
  //    Unexpected structure → 400 (we never store a file we could not strip).
  let clean: Buffer
  try {
    clean = isJpeg ? stripJpegMetadata(buf) : stripPngMetadata(buf)
  } catch (err) {
    if (err instanceof SanitizeError) {
      throw httpError(400, `malformed ${isJpeg ? 'JPEG' : 'PNG'} structure: ${err.message}`)
    }
    throw err
  }

  // 5) All validation passed — only now write the file and link the photo row.
  const uploadDir = envPath('NERDE_UPLOAD_DIR', './public/uploads')
  fs.mkdirSync(uploadDir, { recursive: true })
  const name = `${randomBytes(12).toString('hex')}${isJpeg ? '.jpg' : '.png'}`
  fs.writeFileSync(path.join(uploadDir, name), clean)
  const url = `/uploads/${name}`

  const width = asNumber(body.width)
  const height = asNumber(body.height)
  getDb()
    .prepare('INSERT INTO photos (place_id, url, width, height, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(place.id, url, width, height, ctx.user.id)

  json(ctx.res, 201, { url })
}
