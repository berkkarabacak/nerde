// PlaceCard — compact list card used in the sidebar, bottom sheet, and /saved grid.
import { Link } from 'react-router-dom';
import { CategoryChipsRow, VerifiedLine } from '@/components/place-bits';
import { formatDistance } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PlaceSummary } from '@/lib/api-types';

interface PlaceCardProps {
  place: PlaceSummary;
  distanceKm?: number | null;
  selected?: boolean;
  onSelect?: (place: PlaceSummary) => void;
  onHover?: (placeId: number | null) => void;
}

export default function PlaceCard({
  place,
  distanceKm,
  selected = false,
  onSelect,
  onHover,
}: PlaceCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(place)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onSelect) {
          e.preventDefault();
          onSelect(place);
        }
      }}
      onMouseEnter={() => onHover?.(place.id)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        'flex w-full cursor-pointer gap-3 rounded-lg border bg-white p-3 text-left transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
        selected ? 'border-blue-600' : 'border-neutral-200 hover:border-neutral-300',
      )}
    >
      {place.photo_url ? (
        <img
          src={place.photo_url}
          alt=""
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-md object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-xl"
        >
          {place.categories[0]?.icon ?? '📍'}
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <Link
          to={`/place/${place.slug}`}
          onClick={(e) => e.stopPropagation()}
          className="block truncate text-sm font-medium text-neutral-900 hover:text-blue-600 hover:underline"
        >
          {place.name}
        </Link>
        {/* UX_REVIEW F2: location line so cards read as real places, not placeholders. */}
        {place.city && (
          <p className="truncate text-xs text-neutral-500">
            {place.city}
            {place.country_code ? `, ${place.country_code}` : ''}
          </p>
        )}
        <CategoryChipsRow categories={place.categories} max={2} />
        <div className="flex items-center gap-2">
          <VerifiedLine
            lastVerifiedAt={place.last_verified_at}
            confirmCount={place.confirm_count}
          />
          {typeof distanceKm === 'number' && (
            <span className="text-xs text-neutral-400">{formatDistance(distanceKm)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
