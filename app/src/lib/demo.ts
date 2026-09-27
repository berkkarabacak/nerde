// Demo-mode API client — serves the baked static JSON (scripts/bake-static-api.ts,
// copied to <outDir>/api-static/ by scripts/build-demo.ts) entirely client-side.
// Active only when VITE_DEMO=1 (GitHub Pages build); the normal build never
// bundles this path behind a live value (isDemo is a compile-time constant).
import { ApiRequestError } from './api';
import { haversineKm } from './format';
import type { Category, PlaceDetail, PlaceSummary, PlacesListResponse } from './api-types';

export const isDemo = import.meta.env.VITE_DEMO === '1';

// Vite sets BASE_URL from `base` ('/nerde/' in the demo build, '/' otherwise).
const BASE_URL: string = import.meta.env.BASE_URL || '/';

/** Baked places.json row: PlaceSummary plus the raw attrs object (for filters). */
export interface DemoPlace extends PlaceSummary {
  attrs: Record<string, unknown>;
}

export interface BboxFilter {
  bbox: string; // "w,s,e,n"
  cat?: string | null;
  attrs?: string[];
  q?: string | null;
  limit?: number | null;
}

const DISABLED = 'Disabled in this demo build';

// ── Module-level caches (fetch each baked file at most once per session) ─────

let categoriesCache: Promise<Category[]> | null = null;
let placesCache: Promise<DemoPlace[]> | null = null;
let slugIndexCache: Promise<Record<string, string>> | null = null;
const detailFileCache = new Map<string, Promise<Record<string, PlaceDetail>>>();

async function fetchJson<T>(file: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}api-static/${file}`);
  } catch {
    throw new ApiRequestError(0, { error: 'Network error — check your connection.' });
  }
  if (!res.ok) throw new ApiRequestError(res.status, { error: `Demo data missing: ${file}` });
  return (await res.json()) as T;
}

/** Photos live under the demo base path (/nerde/uploads/...) — rewrite baked root-absolute URLs. */
function rewriteUrl(url: string | null): string | null {
  if (url && url.startsWith('/')) return `${BASE_URL}${url.slice(1)}`;
  return url;
}

function stripAttrs(p: DemoPlace): PlaceSummary {
  const { attrs: _attrs, ...summary } = p;
  return summary;
}

async function loadCategories(): Promise<Category[]> {
  categoriesCache ??= fetchJson<{ categories: Category[] }>('categories.json').then((r) => r.categories);
  return categoriesCache;
}

async function loadPlaces(): Promise<DemoPlace[]> {
  placesCache ??= fetchJson<{ places: DemoPlace[] }>('places.json').then((r) =>
    r.places.map((p) => ({ ...p, photo_url: rewriteUrl(p.photo_url) })),
  );
  return placesCache;
}

async function loadSlugIndex(): Promise<Record<string, string>> {
  slugIndexCache ??= fetchJson<Record<string, string>>('slug-index.json');
  return slugIndexCache;
}

async function loadDetailFile(categorySlug: string): Promise<Record<string, PlaceDetail>> {
  let cached = detailFileCache.get(categorySlug);
  if (!cached) {
    cached = fetchJson<Record<string, PlaceDetail>>(`details/${categorySlug}.json`).then((file) => {
      for (const place of Object.values(file)) {
        place.photo_url = rewriteUrl(place.photo_url);
        place.photos = place.photos.map((ph) => ({ ...ph, url: rewriteUrl(ph.url) ?? ph.url }));
      }
      return file;
    });
    detailFileCache.set(categorySlug, cached);
  }
  return cached;
}

// ── Pure query helpers (exported for unit tests — no fetch involved) ─────────

/** Normalize any longitude into [-180, 180] (mirrors server/db.ts). */
export function normalizeLng(lng: number): number {
  let v = lng % 360;
  if (v > 180) v -= 360;
  if (v < -180) v += 360;
  return v;
}

/** Deterministic scatter score (CONTRACTS amendment A4: (id * 2654435761) % 100000). */
export function scatterScore(id: number): number {
  return (id * 2654435761) % 100000;
}

/** Server-side JSON truthiness for attr filters: false/0/''/null/missing are falsy. */
function truthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false && value !== 0 && value !== '';
}

/**
 * Client-side mirror of GET /api/places?bbox=… (server/routes/places.ts):
 * antimeridian-aware lng band, optional cat/attrs/q filters, limit default 500
 * (cap 1000), deterministic scatter sample + honest total_count/truncated.
 */
export function filterDemoPlaces(
  places: DemoPlace[],
  filter: BboxFilter,
  knownAttrKeys?: Set<string>,
): PlacesListResponse {
  const parts = filter.bbox.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new ApiRequestError(400, { error: 'invalid bbox — expected "w,s,e,n" numbers' });
  }
  const s = Math.max(-90, Math.min(90, parts[1]));
  const n = Math.max(-90, Math.min(90, parts[3]));
  if (s > n) throw new ApiRequestError(400, { error: 'invalid bbox — south is greater than north' });
  const w = normalizeLng(parts[0]);
  const e = normalizeLng(parts[2]);
  const wraps = w > e;

  const cat = (filter.cat ?? '').trim() || null;
  const q = (filter.q ?? '').trim().slice(0, 100).toLowerCase() || null;
  const limit = Math.max(1, Math.min(1000, Math.trunc(filter.limit ?? 500) || 500));

  const attrKeys = (filter.attrs ?? []).slice(0, 20);
  for (const key of attrKeys) {
    if (knownAttrKeys && !knownAttrKeys.has(key)) {
      throw new ApiRequestError(400, { error: `unknown attribute filter "${key}"` });
    }
  }

  const matched = places.filter((p) => {
    if (p.lat < s || p.lat > n) return false;
    if (wraps ? p.lng < w && p.lng > e : p.lng < w || p.lng > e) return false;
    if (cat && !p.categories.some((c) => c.slug === cat)) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    for (const key of attrKeys) {
      if (!truthy(p.attrs[key])) return false;
    }
    return true;
  });

  const total = matched.length;
  const limited =
    total > limit
      ? matched
          .slice()
          .sort((a, b) => scatterScore(a.id) - scatterScore(b.id) || a.id - b.id)
          .slice(0, limit)
      : matched;

  return {
    places: limited.map(stripAttrs),
    total_count: total,
    truncated: total > limited.length,
  };
}

/** Client-side mirror of GET /api/places/near (haversine, radius, sorted, max 50). */
export function nearDemoPlaces(
  places: DemoPlace[],
  lat: number,
  lng: number,
  radiusKm = 30,
  cat?: string | null,
): Array<PlaceSummary & { distance_km: number }> {
  return places
    .filter((p) => !cat || p.categories.some((c) => c.slug === cat))
    .map((p) => ({ ...stripAttrs(p), distance_km: haversineKm(lat, lng, p.lat, p.lng) }))
    .filter((p) => p.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 50)
    .map((p) => ({ ...p, distance_km: Math.round(p.distance_km * 100) / 100 }));
}

/** Client-side mirror of GET /api/search (categories by name; places by name, 8 each). */
export function searchDemo(
  categories: Category[],
  places: DemoPlace[],
  rawQ: string,
): { categories: Category[]; places: PlaceSummary[] } {
  const q = rawQ.trim().slice(0, 100).toLowerCase();
  if (!q) return { categories: [], places: [] };
  return {
    categories: categories.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8),
    places: places
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => b.confirm_count - a.confirm_count || a.id - b.id)
      .slice(0, 8)
      .map(stripAttrs),
  };
}

// ── The demo API router (drop-in for api.ts request<T>) ──────────────────────

export async function demoApi<T>(method: string, path: string): Promise<T> {
  const url = new URL(path, 'http://demo.invalid');
  const route = url.pathname;
  const q = url.searchParams;

  if (method === 'GET' && route === '/api/categories') {
    return { categories: await loadCategories() } as T;
  }

  if (method === 'GET' && route === '/api/places') {
    const bbox = q.get('bbox');
    if (!bbox) throw new ApiRequestError(400, { error: 'bbox is required as "w,s,e,n"' });
    const categories = await loadCategories();
    const knownAttrKeys = new Set(
      categories.flatMap((c) => c.attributes.map((a) => `${c.slug}.${a.key}`)),
    );
    const rawLimit = q.get('limit');
    return filterDemoPlaces(
      await loadPlaces(),
      {
        bbox,
        cat: q.get('cat'),
        attrs: (q.get('attrs') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        q: q.get('q'),
        limit: rawLimit === null ? null : Number(rawLimit),
      },
      knownAttrKeys,
    ) as T;
  }

  if (method === 'GET' && route === '/api/places/near') {
    const lat = Number(q.get('lat'));
    const lng = Number(q.get('lng'));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new ApiRequestError(400, { error: 'lat must be between -90 and 90' });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new ApiRequestError(400, { error: 'lng must be between -180 and 180' });
    }
    const rawRadius = Number(q.get('radius_km'));
    const radiusKm = Number.isFinite(rawRadius) ? Math.max(0.1, Math.min(500, rawRadius)) : 30;
    return {
      places: nearDemoPlaces(await loadPlaces(), lat, lng, radiusKm, (q.get('cat') ?? '').trim() || null),
    } as T;
  }

  const detailMatch = /^\/api\/places\/([^/]+)$/.exec(route);
  if (method === 'GET' && detailMatch) {
    const slug = decodeURIComponent(detailMatch[1]);
    const index = await loadSlugIndex();
    const categorySlug = index[slug];
    if (!categorySlug) throw new ApiRequestError(404, { error: 'place not found' });
    const file = await loadDetailFile(categorySlug);
    const place = file[slug];
    if (!place) throw new ApiRequestError(404, { error: 'place not found' });
    return { place } as T;
  }

  if (method === 'GET' && route === '/api/search') {
    return searchDemo(await loadCategories(), await loadPlaces(), q.get('q') ?? '') as T;
  }

  if (method === 'GET' && route === '/api/auth/me') {
    return { user: null } as T;
  }

  if (method === 'POST' && route === '/api/events') {
    return undefined as T; // 204 — analytics are dropped in the demo build
  }

  // login/signup/save/verify/comments/report/photos/admin/… — no server here.
  throw new ApiRequestError(403, { error: DISABLED });
}
