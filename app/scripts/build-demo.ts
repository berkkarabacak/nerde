// Static demo build orchestrator (GitHub Pages):
//   1. bake db/nerde.sqlite → demo-static/*.json   (scripts/bake-static-api.ts)
//   2. vite build --mode demo → dist-demo/          (base /nerde/, VITE_DEMO=1)
//   3. dist-demo/index.html → dist-demo/404.html    (GitHub Pages SPA fallback)
//   4. demo-static/ → dist-demo/api-static/         (the baked API)
//
// Run: npm run build:demo
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(APP_ROOT, 'dist-demo')
const STATIC_SRC = path.join(APP_ROOT, 'demo-static')
const STATIC_DEST = path.join(OUT_DIR, 'api-static')

function run(cmd: string, args: string[]): void {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  // No shell: process.execPath / npx.cmd contain spaces on Windows; shell:true
  // would split them. npx needs its .cmd shim when shell is off.
  const res = spawnSync(cmd, args, { cwd: APP_ROOT, stdio: 'inherit' })
  if (res.status !== 0) {
    console.error(`build-demo: step failed (${cmd} exited ${res.status ?? 'unknown'})`)
    process.exit(res.status ?? 1)
  }
}

run(process.execPath, [path.join('scripts', 'bake-static-api.ts')])
// Run vite directly via its JS entry — avoids the npx shim entirely.
run(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'demo'])

// SPA fallback: GitHub Pages serves 404.html for unknown paths with a 404
// status but full content — React Router takes over client-side.
fs.copyFileSync(path.join(OUT_DIR, 'index.html'), path.join(OUT_DIR, '404.html'))

fs.rmSync(STATIC_DEST, { recursive: true, force: true })
fs.cpSync(STATIC_SRC, STATIC_DEST, { recursive: true })

const files: string[] = []
const walk = (dir: string): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else files.push(full)
  }
}
walk(STATIC_DEST)
const total = files.reduce((n, f) => n + fs.statSync(f).size, 0)
console.log(`\nbuild-demo: OK → dist-demo/ (api-static: ${files.length} files, ${(total / 1024 / 1024).toFixed(2)} MB)`)
