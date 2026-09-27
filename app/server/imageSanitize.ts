// Server-side EXIF / privacy strip for uploaded photos (MVP_BACKLOG P1-12,
// CRITICAL_REVIEW B2-iv, PRODUCT_SPEC §28).
//
// Why: the honest-browser path re-encodes via canvas (AddPlace.tsx), which
// strips metadata by construction — but a direct API client can upload the
// original camera bytes, keeping full EXIF incl. GPS coordinates. For a
// vanlife overnight spot that is exactly the privacy leak §28 cares about.
// So the server strips metadata itself, treating client bytes as untrusted.
//
// Pure byte manipulation, no dependencies:
//
//   JPEG — walk the marker segments; DROP APP1 (0xE1: Exif AND XMP), APP13
//   (0xED: Photoshop/IPTC) and COM (0xFE). KEEP SOI, APP0 (JFIF), APP2 (ICC
//   colour profile — dropping it would shift colours), and all frame data.
//   Entropy-coded scan data (after each SOS) is scanned byte-wise so that
//   metadata segments hiding BETWEEN scans (legal in progressive JPEGs) are
//   dropped too. Stuffed bytes (FF 00) and restart markers (FF D0–D7) inside
//   scans are skipped, not mistaken for real markers.
//
//   PNG — walk the chunks; DROP eXIf plus the textual chunks tEXt / iTXt /
//   zTXt. Kept chunks are copied byte-for-byte, so their CRCs stay valid
//   with no recomputation (chunks are self-contained: len|type|data|crc).
//
// FAIL SAFE: any unexpected structure (bad SOI/signature, non-marker byte,
// truncated or zero-length segment, missing EOI/IEND) throws SanitizeError
// and the route answers 400 — nothing is written. Bytes after EOI / IEND
// are dropped rather than served back (nothing may hide behind the image).
//
// Deliberately NOT done: CRC revalidation of kept PNG chunks (we only drop
// whole chunks; kept bytes are untouched) and JPEG thumbnail/EXIF rewriting
// (dropping whole segments needs no offsets rewritten).

/** Error type for malformed image structure → route maps it to 400. */
export class SanitizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SanitizeError'
  }
}

const JPEG_SOI = 0xd8
const JPEG_EOI = 0xd9
const JPEG_SOS = 0xda
const JPEG_TEM = 0x01

/** Markers whose payload we drop: APP1 (Exif+XMP), APP13 (IPTC), COM. */
const JPEG_DROP_MARKERS = new Set<number>([0xe1, 0xed, 0xfe])

/** Restart markers RST0–RST7: standalone, valid inside entropy-coded data. */
const isRst = (m: number): boolean => m >= 0xd0 && m <= 0xd7

/** PNG chunk types we drop (metadata / free text). */
const PNG_DROP_CHUNKS = new Set<string>(['eXIf', 'tEXt', 'iTXt', 'zTXt'])

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Return `buf` with JPEG metadata segments removed. The result always starts
 * with SOI (FF D8) and ends with EOI (FF D9); anything after EOI is dropped.
 */
export function stripJpegMetadata(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== JPEG_SOI) {
    throw new SanitizeError('missing SOI')
  }
  const out: Buffer[] = [buf.subarray(0, 2)]
  let pos = 2
  let done = false

  while (!done) {
    // A marker = one or more 0xFF fill bytes + a non-0xFF, non-0x00 byte.
    if (pos >= buf.length) throw new SanitizeError('truncated: no EOI found')
    if (buf[pos] !== 0xff) throw new SanitizeError(`expected marker at offset ${pos}`)
    let i = pos
    while (i < buf.length && buf[i] === 0xff) i++ // fill bytes
    if (i >= buf.length) throw new SanitizeError('truncated marker at end of file')
    const marker = buf[i]
    if (marker === 0x00) throw new SanitizeError('stuffed byte outside scan data')
    if (marker === JPEG_SOI) throw new SanitizeError('unexpected second SOI')
    const markerEnd = i + 1 // end of the fill+marker sequence

    if (marker === JPEG_EOI) {
      out.push(buf.subarray(pos, markerEnd))
      done = true // trailing bytes after EOI are intentionally dropped
      break
    }

    // TEM (0x01) and RSTn carry no length field. (RSTn outside a scan is
    // technically invalid, but copying it is harmless; we fail only on
    // structure we cannot safely account for.)
    if (marker === JPEG_TEM || isRst(marker)) {
      out.push(buf.subarray(pos, markerEnd))
      pos = markerEnd
      continue
    }

    // Length-prefixed segment: length includes its own 2 bytes.
    if (markerEnd + 2 > buf.length) throw new SanitizeError('truncated segment length')
    const segLen = buf.readUInt16BE(markerEnd)
    if (segLen < 2) throw new SanitizeError(`invalid segment length ${segLen} at offset ${pos}`)
    const segEnd = markerEnd + segLen
    if (segEnd > buf.length) throw new SanitizeError(`segment at offset ${pos} overruns end of file`)

    if (!JPEG_DROP_MARKERS.has(marker)) {
      out.push(buf.subarray(pos, segEnd))
    }

    if (marker === JPEG_SOS) {
      // Entropy-coded scan data follows until the next REAL marker. FF 00 is
      // a stuffed data byte; FF D0–D7 are restart markers — skip both kinds.
      let p = segEnd
      for (;;) {
        if (p >= buf.length) throw new SanitizeError('scan data runs past end of file (no EOI)')
        if (buf[p] === 0xff && p + 1 < buf.length) {
          const next = buf[p + 1]
          if (next === 0x00 || isRst(next)) {
            p += 2
            continue
          }
          if (next === 0xff) {
            p += 1 // consecutive fill byte — keep scanning
            continue
          }
          out.push(buf.subarray(segEnd, p)) // copy the scan verbatim…
          pos = p // …and let the main loop handle the real marker
          break
        }
        p++
      }
      continue
    }

    pos = segEnd
  }

  return Buffer.concat(out)
}

/**
 * Return `buf` with PNG metadata chunks removed (eXIf, tEXt, iTXt, zTXt).
 * Kept chunks are copied verbatim — no CRC recomputation needed. Bytes after
 * IEND are dropped.
 */
export function stripPngMetadata(buf: Buffer): Buffer {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new SanitizeError('missing PNG signature')
  }
  const out: Buffer[] = [buf.subarray(0, 8)]
  let pos = 8
  let seenIend = false

  while (pos < buf.length) {
    if (pos + 8 > buf.length) throw new SanitizeError('truncated chunk header')
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    if (!/^[A-Za-z]{4}$/.test(type)) throw new SanitizeError(`invalid chunk type at offset ${pos}`)
    const end = pos + 12 + len // length + type + data + crc
    if (end > buf.length) throw new SanitizeError(`chunk ${type} at offset ${pos} overruns end of file`)
    if (!PNG_DROP_CHUNKS.has(type)) {
      out.push(buf.subarray(pos, end))
    }
    pos = end
    if (type === 'IEND') {
      seenIend = true
      break // trailing bytes after IEND are intentionally dropped
    }
  }
  if (!seenIend) throw new SanitizeError('no IEND chunk')
  return Buffer.concat(out)
}
