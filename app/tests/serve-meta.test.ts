// Production-shell integration test (SEO_STRATEGY §2.3, MVP_BACKLOG P1-05+):
// boots the REAL server/serve.ts as a child process on an ephemeral port with
// a seeded temp DB and verifies the injected HTML over HTTP.
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanupTmp, freshDb, insertPlace } from './helpers.ts'
import { closeDb, getDb } from '../server/db.ts'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface RunningServer {
  base: string
  child: ChildProcess
}

/** Boot server/serve.ts; resolve once the listening line reports the port. */
function startProdServer(env: NodeJS.ProcessEnv): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/serve.ts'], {
      cwd: APP_ROOT,
      env: { ...process.env, PORT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`serve.ts did not start within 20s. stderr:\n${stderr}`))
    }, 20_000)
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.stdout.on('data', (chunk) => {
      const match = /listening on http:\/\/localhost:(\d+)/.exec(String(chunk))
      if (match) {
        clearTimeout(timeout)
        resolve({ base: `http://127.0.0.1:${match[1]}`, child })
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`serve.ts exited early (code ${code}). stderr:\n${stderr}`))
    })
  })
}

function stopProdServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5_000)
    child.on('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

describe('serve.ts — HTML-shell meta injection over HTTP', () => {
  afterAll(cleanupTmp)

  it('GET /place/:slug carries og:title + ld+json while the JS bundle stays intact', async () => {
    // Seed a temp DB in-process, then hand the file to the child server.
    freshDb()
    const db = getDb()
    const place = insertPlace(db, {
      name: 'Serve Meta Park',
      lat: 41.047,
      lng: 28.992,
      cats: ['calisthenics'],
      description: 'Outdoor gym with pull-up bars next to the ferry pier.',
      city: 'Istanbul',
      country: 'Turkey',
      country_code: 'TR',
    })
    const dbPath = process.env.NERDE_DB_PATH!
    const uploadDir = process.env.NERDE_UPLOAD_DIR!
    closeDb() // checkpoint WAL + release the file before the child opens it

    const { base, child } = await startProdServer({
      NERDE_DB_PATH: dbPath,
      NERDE_UPLOAD_DIR: uploadDir,
      // Pin the origin so canonical/OG URLs are deterministic regardless of
      // the shell env the test runner inherited.
      NERDE_BASE_URL: 'http://localhost:7100',
    })
    try {
      const res = await fetch(`${base}/place/${place.slug}`)
      const html = await res.text()
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')

      // Route-specific meta is in the served shell…
      expect(html).toContain('<title>Serve Meta Park, Istanbul — Nerde</title>')
      expect(html).toContain('<meta property="og:title" content="Serve Meta Park, Istanbul — Nerde" />')
      expect(html).toContain('<meta property="og:type" content="place" />')
      expect(html).toContain(`<link rel="canonical" href="http://localhost:7100/place/${place.slug}" />`)
      expect(html).toContain('<script type="application/ld+json">')
      expect(html).toContain('"@type":"Place"')
      expect(html).toContain('"@type":"GeoCoordinates"')
      expect(html).toContain('"latitude":41.047')
      // …and the SPA itself is untouched: bundle + mount point intact.
      expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/[^"]+\.js"><\/script>/)
      expect(html).toContain('<div id="root"></div>')

      // Home carries WebSite JSON-LD and the §4 default title.
      const home = await (await fetch(`${base}/`)).text()
      expect(home).toContain('<title>Nerde — Specialized Maps for Specific Places</title>')
      expect(home).toContain('"@type":"WebSite"')
      expect(home).toContain('"@type":"SearchAction"')

      // Unknown slug → plain shell, no route meta (SPA not-found flow owns it).
      const miss = await (await fetch(`${base}/place/does-not-exist-zz`)).text()
      expect(miss).toContain('<title>Nerde — Specialized Maps for Specific Places</title>')
      expect(miss).not.toContain('og:title')
      expect(miss).toMatch(/<script type="module" crossorigin src="\/assets\/[^"]+\.js"><\/script>/)

      // Non-indexable routes are not touched either.
      const login = await (await fetch(`${base}/login`)).text()
      expect(login).not.toContain('og:title')
    } finally {
      await stopProdServer(child)
    }
  }, 30_000)
})
