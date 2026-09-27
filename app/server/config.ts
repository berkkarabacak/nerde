// Shared runtime configuration. Values are read per call (never cached at
// import time) so tests and scripts can toggle env vars freely.

/**
 * Canonical site origin, no trailing slash. Used for the Google OAuth
 * redirect_uri and for absolute URLs in server-injected meta/OG tags
 * (server/meta.ts). Default is the local dev server; production sets
 * NERDE_BASE_URL=https://nerde.com.
 *
 * NOTE: server/routes/seo.ts (sitemap/robots) historically defaults the same
 * env var to https://nerde.com — its contract-pinned output is unchanged; this
 * default governs only the new OAuth + meta-injection features.
 */
export function baseUrl(): string {
  return (process.env.NERDE_BASE_URL ?? 'http://localhost:7100').replace(/\/+$/, '')
}
