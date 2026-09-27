// Nerde production server (`npm start` → `node server/serve.ts`).
// One node:http process serving: the API (/api/*, /sitemap.xml, /robots.txt)
// via handleApi, user photos from NERDE_UPLOAD_DIR at /uploads/*, static build
// output from dist/, and an SPA fallback to dist/index.html for other GETs.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApi } from './index.ts'
import { envPath } from './db.ts'
import { injectMeta, renderMetaForPath } from './meta.ts'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = path.join(APP_ROOT, 'dist')
const UPLOAD_DIR = envPath('NERDE_UPLOAD_DIR', './public/uploads')
const PORT = Number(process.env.PORT ?? 7100)

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
}

/** Resolve a URL path inside `baseDir`; null on traversal attempts. */
function safeJoin(baseDir: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const resolved = path.resolve(baseDir, `.${decoded}`)
  return resolved === baseDir || resolved.startsWith(baseDir + path.sep) ? resolved : null
}

function sendFile(res: http.ServerResponse, filePath: string, cacheControl: string): void {
  const ext = path.extname(filePath).toLowerCase()
  res.statusCode = 200
  res.setHeader('content-type', MIME_TYPES[ext] ?? 'application/octet-stream')
  res.setHeader('content-length', fs.statSync(filePath).size)
  res.setHeader('cache-control', cacheControl)
  fs.createReadStream(filePath).pipe(res)
}

// ── HTML-shell meta injection (SEO_STRATEGY §2.3, MVP_BACKLOG P1-05) ─────────
// For the indexable routes (/, /c/:slug, /place/:slug) the shell is served
// with per-route title/description/OG/JSON-LD filled from the DB so crawlers
// and link unfurlers see correct metadata without running JS. Small in-memory
// cache keyed by path (60s TTL); unknown slugs return null → plain shell and
// the SPA's not-found flow take over unchanged.
const SHELL_CACHE_TTL_MS = 60_000
const SHELL_CACHE_MAX = 500
const shellCache = new Map<string, { html: string; expires: number }>()

function renderShellWithMeta(urlPath: string, indexPath: string): string | null {
  const now = Date.now()
  const cached = shellCache.get(urlPath)
  if (cached && cached.expires > now) return cached.html
  const meta = renderMetaForPath(urlPath)
  if (!meta) return null
  const html = injectMeta(fs.readFileSync(indexPath, 'utf8'), meta)
  if (shellCache.size >= SHELL_CACHE_MAX) shellCache.clear()
  shellCache.set(urlPath, { html, expires: now + SHELL_CACHE_TTL_MS })
  return html
}

const server = http.createServer(async (req, res) => {
  try {
    // API + sitemap + robots.
    if (await handleApi(req, res)) return

    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end('method not allowed')
      return
    }
    const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname

    // User-uploaded photos (random unguessable names → long cache is safe).
    if (urlPath.startsWith('/uploads/')) {
      // Strip the /uploads prefix: files live directly inside NERDE_UPLOAD_DIR.
      const filePath = safeJoin(UPLOAD_DIR, urlPath.slice('/uploads'.length))
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        sendFile(res, filePath, 'public, max-age=31536000, immutable')
        return
      }
      res.statusCode = 404
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end('not found')
      return
    }

    // Static build output.
    const filePath = safeJoin(DIST_DIR, urlPath)
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      // Vite hashes files under /assets/ → immutable; everything else revalidates.
      const cache = urlPath.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache'
      sendFile(res, filePath, cache)
      return
    }

    // SPA fallback: any other GET renders the app shell.
    const indexPath = path.join(DIST_DIR, 'index.html')
    if (fs.existsSync(indexPath)) {
      if (method === 'GET') {
        const metaHtml = renderShellWithMeta(urlPath, indexPath)
        if (metaHtml !== null) {
          res.statusCode = 200
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.setHeader('content-length', Buffer.byteLength(metaHtml))
          res.setHeader('cache-control', 'no-cache')
          res.end(metaHtml)
          return
        }
      }
      sendFile(res, indexPath, 'no-cache')
      return
    }
    res.statusCode = 503
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end('dist/index.html not found — run `npm run build` first (or use `npm run dev`)')
  } catch (err) {
    console.error('[nerde-server]', err)
    if (!res.writableEnded) {
      res.statusCode = 500
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end('internal server error')
    }
  }
})

server.listen(PORT, () => {
  // Log the bound port (PORT=0 → ephemeral; tests parse this line).
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : PORT
  console.log(`[nerde-server] listening on http://localhost:${port}`)
  console.log(`[nerde-server] static: ${DIST_DIR}`)
  console.log(`[nerde-server] uploads: ${UPLOAD_DIR}`)
})
