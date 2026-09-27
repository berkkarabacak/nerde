// CityQuickLinks — one-tap jumps to the densest seed cities (UX_REVIEW F1).
// Text-link styling per DESIGN_SYSTEM (muted row, blue links); flies the map
// via mapBus so it works from anywhere the map page is mounted.
import { mapBus } from '@/lib/map-bus';
import { strings } from '@/lib/strings';
import { cn } from '@/lib/utils';

const QUICK_CITIES = [
  { name: 'Istanbul', lat: 41.0082, lng: 28.9784 },
  { name: 'Berlin', lat: 52.52, lng: 13.405 },
  { name: 'New York', lat: 40.7484, lng: -73.9857 },
] as const;

const CITY_ZOOM = 11;

export default function CityQuickLinks({ className }: { className?: string }) {
  return (
    <nav
      aria-label={strings.map.cityLinksLabel}
      className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs', className)}
    >
      <span className="text-neutral-400">{strings.map.cityLinksLabel}</span>
      {QUICK_CITIES.map((c, i) => (
        <span key={c.name} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true" className="text-neutral-300">·</span>}
          <button
            type="button"
            onClick={() => mapBus.flyTo(c.lat, c.lng, CITY_ZOOM)}
            className="rounded text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {c.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
