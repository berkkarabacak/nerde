import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// Serves /api/*, /sitemap.xml and /robots.txt from ./server (erasable TS) inside
// the Vite dev server, so `npm run dev` runs the whole product in one process.
function nerdeApi(): Plugin {
  return {
    name: 'nerde-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/') && url !== '/sitemap.xml' && url !== '/robots.txt') return next()
        try {
          const mod = await server.ssrLoadModule('/server/index.ts')
          const handled = await mod.handleApi(req, res)
          if (!handled) next()
        } catch (err) {
          console.error('[nerde-api]', err)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'internal server error' }))
        }
      })
    },
    // Dev-side per-route meta injection (SEO_STRATEGY §2.3): same server/meta.ts
    // the prod server (server/serve.ts) uses, so dev and prod shells match.
    // Async hook; any failure falls back to the untouched shell.
    async transformIndexHtml(html, ctx) {
      const pathname = new URL(ctx.originalUrl ?? ctx.path, 'http://localhost').pathname
      if (pathname !== '/' && !pathname.startsWith('/c/') && !pathname.startsWith('/place/')) return
      if (!ctx.server) return
      try {
        const mod = await ctx.server.ssrLoadModule('/server/meta.ts')
        const meta = mod.renderMetaForPath(pathname)
        if (!meta) return
        return mod.injectMeta(html, meta) as string
      } catch (err) {
        console.error('[nerde-meta]', err)
      }
    },
  }
}

// https://vite.dev/config/
// mode 'demo' (vite build --mode demo): static GitHub Pages build under /nerde/
// with VITE_DEMO=1 (from .env.demo) — see scripts/build-demo.ts.
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/nerde/' : '/',
  plugins: [nerdeApi(), inspectAttr(), react()],
  server: {
    port: 7100,
    strictPort: false,
    host: true,
  },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
