// Typed fetch wrapper for the Nerde API (CONTRACTS.md §6).
import type {
  ApiError,
  Category,
  PlaceDetail,
  PlaceSummary,
  PlacesListResponse,
  SearchResults,
  SessionUser,
} from './api-types';
import { demoApi, isDemo } from './demo';

export class ApiRequestError extends Error {
  status: number;
  data: ApiError;

  constructor(status: number, data: ApiError) {
    super(data.error || `Request failed (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.data = data;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Demo build (VITE_DEMO=1): serve the baked static JSON instead of the Node API.
  if (isDemo) return demoApi<T>(init?.method ?? 'GET', path);
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiRequestError(0, { error: 'Network error — check your connection.' });
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => ({ error: 'Invalid server response' }));
  if (!res.ok) {
    throw new ApiRequestError(res.status, data as ApiError);
  }
  return data as T;
}

export interface BboxQuery {
  bbox: string; // "w,s,e,n"
  cat?: string;
  attrs?: string[]; // cat.key entries, AND semantics
  q?: string;
  limit?: number;
}

export const api = {
  // Public
  categories: () => request<{ categories: Category[] }>('/api/categories'),

  places: (query: BboxQuery) => {
    const p = new URLSearchParams({ bbox: query.bbox });
    if (query.cat) p.set('cat', query.cat);
    if (query.attrs && query.attrs.length > 0) p.set('attrs', query.attrs.join(','));
    if (query.q) p.set('q', query.q);
    p.set('limit', String(query.limit ?? 500));
    return request<PlacesListResponse>(`/api/places?${p.toString()}`);
  },

  placesNear: (lat: number, lng: number, radiusKm = 30, cat?: string) => {
    const p = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius_km: String(radiusKm),
    });
    if (cat) p.set('cat', cat);
    return request<{ places: (PlaceSummary & { distance_km: number })[] }>(`/api/places/near?${p.toString()}`);
  },

  place: (slug: string) =>
    request<{ place: PlaceDetail; canonical_slug?: string }>(`/api/places/${encodeURIComponent(slug)}`),

  search: (q: string) => request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),

  createPlace: (body: {
    name: string;
    description: string;
    lat: number;
    lng: number;
    categories: string[];
    attrs: Record<string, unknown>;
    address?: string;
    city?: string;
    country?: string;
    country_code?: string;
    force?: boolean;
    website?: string; // honeypot
  }) => request<{ place: { id: number; slug: string } }>('/api/places', { method: 'POST', body: JSON.stringify(body) }),

  uploadPhoto: (placeId: number, dataUrl: string) =>
    request<{ url: string }>('/api/photos', { method: 'POST', body: JSON.stringify({ place_id: placeId, dataUrl }) }),

  verify: (placeId: number, type: 'confirm' | 'issue', note?: string) =>
    request<unknown>(`/api/places/${placeId}/verify`, { method: 'POST', body: JSON.stringify({ type, note }) }),

  addComment: (placeId: number, body: string) =>
    request<unknown>(`/api/places/${placeId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),

  report: (placeId: number, reason: string, note?: string) =>
    request<unknown>(`/api/places/${placeId}/report`, { method: 'POST', body: JSON.stringify({ reason, note }) }),

  save: (placeId: number) => request<unknown>(`/api/places/${placeId}/save`, { method: 'POST' }),
  unsave: (placeId: number) => request<unknown>(`/api/places/${placeId}/save`, { method: 'DELETE' }),

  // Auth
  signup: (email: string, username: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, username, password }) }),
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<unknown>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: SessionUser | null }>('/api/auth/me'),

  // User
  mySaved: () => request<{ places: PlaceSummary[] }>('/api/me/saved'),
  myPlaces: () => request<{ places: PlaceSummary[] }>('/api/me/places'),
};
