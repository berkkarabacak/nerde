// Pinned API types — shared contract between frontend and backend (CONTRACTS.md §6).
// Do not change without recording the change in CONTRACTS.md.

export type AttrType = 'bool' | 'enum' | 'number' | 'text'

export interface CategoryAttribute {
  key: string
  label: string
  type: AttrType
  options: string[] | null
  filterable: boolean
  sort: number
}

export interface Category {
  id: number
  slug: string
  name: string
  icon: string
  color: string
  grp: 'fitness' | 'outdoor'
  sort: number
  /** Published places in this category (contract amendment, CRITICAL_REVIEW B3). */
  place_count: number
  attributes: CategoryAttribute[]
}

export interface CategoryRef {
  slug: string
  name: string
  icon: string
  color: string
}

export interface PlaceSummary {
  id: number
  slug: string
  name: string
  lat: number
  lng: number
  categories: CategoryRef[]
  photo_url: string | null
  confirm_count: number
  last_verified_at: string | null
  /** Empty string when unset (contract amendment A9, UX_REVIEW F2). */
  city: string
  /** ISO 3166-1 alpha-2, uppercase; empty string when unset (amendment A9). */
  country_code: string
}

/**
 * GET /api/places?bbox=… response (contract amendment, CRITICAL_REVIEW I1):
 * total_count is the full bbox count; truncated=true means `places` is a
 * deterministic spatially-scattered SAMPLE of total_count rows — zoom in.
 */
export interface PlacesListResponse {
  places: PlaceSummary[]
  total_count: number
  truncated: boolean
}

export interface ResolvedAttr {
  category_slug: string
  key: string
  label: string
  type: AttrType
  value: boolean | number | string | null
}

export interface PlacePhoto {
  url: string
  width: number | null
  height: number | null
}

export interface PlaceComment {
  username: string
  body: string
  created_at: string
}

export interface PlaceDetail extends PlaceSummary {
  description: string
  address: string
  city: string
  region: string
  country: string
  country_code: string
  attrs_resolved: ResolvedAttr[]
  photos: PlacePhoto[]
  comments: PlaceComment[]
  created_by_username: string | null
  created_at: string
  issue_count: number
  source: 'community' | 'osm' | 'curated'
  saved_by_me: boolean
}

export interface SessionUser {
  id: number
  username: string
  role: 'user' | 'admin'
}

export interface SearchResults {
  categories: Category[]
  places: PlaceSummary[]
}

export interface ApiError {
  error: string
  duplicates?: PlaceSummary[]
}

export type EventType =
  | 'category_selected'
  | 'search_performed'
  | 'place_viewed'
  | 'place_saved'
  | 'add_place_started'
  | 'place_submitted'
  | 'place_verified'
  | 'place_reported'
  | 'filter_applied'
  | 'near_me_used'
