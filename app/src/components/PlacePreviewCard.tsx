// Preview card shown when a marker is selected — rendered inside a MapLibre
// Popup on desktop and as a fixed card above the bottom sheet on mobile.
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CategoryChipsRow, VerifiedLine } from '@/components/place-bits';
import { formatDistance } from '@/lib/format';
import { strings } from '@/lib/strings';
import type { PlaceSummary } from '@/lib/api-types';

export function PlacePreviewCard({
  place,
  distanceKm,
  onClose,
}: {
  place: PlaceSummary;
  distanceKm?: number | null;
  onClose?: () => void;
}) {
  return (
    <div className="w-[260px] overflow-hidden rounded-lg bg-white text-left">
      {place.photo_url && (
        <img
          src={place.photo_url}
          alt={place.name}
          loading="lazy"
          className="h-24 w-full object-cover"
        />
      )}
      <div className="space-y-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-neutral-900">{place.name}</p>
          {onClose && (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            >
              ✕
            </button>
          )}
        </div>
        <CategoryChipsRow categories={place.categories} max={2} />
        {/* UX_REVIEW F2: location line (city known for all imported places). */}
        {place.city && (
          <p className="truncate text-xs text-neutral-500">
            {place.city}
            {place.country_code ? `, ${place.country_code}` : ''}
          </p>
        )}
        <div className="flex items-center gap-2">
          <VerifiedLine
            lastVerifiedAt={place.last_verified_at}
            confirmCount={place.confirm_count}
          />
          {typeof distanceKm === 'number' && (
            <span className="text-xs text-neutral-400">{formatDistance(distanceKm)} away</span>
          )}
        </div>
        <Button asChild size="sm" className="mt-1 w-full">
          <Link to={`/place/${place.slug}`}>{strings.place.viewDetails}</Link>
        </Button>
      </div>
    </div>
  );
}
