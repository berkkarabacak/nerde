// Time/number formatting helpers (CONTRACTS §7: ISO UTC strings, relative time client-side).
import { strings } from './strings';

/** Whole days between an ISO timestamp and now (negative clamped to 0). */
export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Date.now() - then;
  return Math.max(0, Math.floor(diff / 86_400_000));
}

/**
 * Verification display line per DESIGN_SYSTEM §8.5 / §12.
 * Returns { text, tone } — tone drives the semantic color.
 */
export function verifiedLine(lastVerifiedAt: string | null | undefined): {
  text: string;
  tone: 'success' | 'warning' | 'muted';
} {
  const days = daysAgo(lastVerifiedAt);
  if (days === null) return { text: strings.place.notVerified, tone: 'muted' };
  if (days < 1) return { text: strings.place.verifiedToday, tone: 'success' };
  if (days > 180) return { text: strings.place.stale(days), tone: 'warning' };
  return { text: strings.place.verifiedDaysAgo(days), tone: 'success' };
}

/** Short relative time for comments etc., e.g. "3 days ago". */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/** "1.2 km" / "450 m" */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Haversine distance in km between two lat/lng points. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Short date, e.g. "2024-11-02". */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
