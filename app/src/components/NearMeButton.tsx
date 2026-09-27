// NearMeButton — browser geolocation only; coords never leave the device except
// as transient query params (CONTRACTS §7). States: idle/locating/located/denied.
import { useState } from 'react';
import { LocateFixed, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/events';
import { strings } from '@/lib/strings';
import { cn } from '@/lib/utils';

type NearMeState = 'idle' | 'locating' | 'located';

export default function NearMeButton({
  onLocated,
  variant = 'fab',
}: {
  onLocated: (coords: { lat: number; lng: number }) => void;
  variant?: 'fab' | 'button';
}) {
  const [state, setState] = useState<NearMeState>('idle');

  const locate = () => {
    if (!('geolocation' in navigator)) {
      toast.error(strings.nearMe.error);
      return;
    }
    setState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setState('located');
        track('near_me_used');
        onLocated(coords);
      },
      (err) => {
        setState('idle');
        if (err.code === err.PERMISSION_DENIED) {
          toast.error(strings.nearMe.denied);
        } else {
          toast.error(strings.nearMe.error);
        }
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const busy = state === 'locating';

  if (variant === 'button') {
    return (
      <Button
        variant={state === 'located' ? 'default' : 'outline'}
        size="sm"
        onClick={locate}
        disabled={busy}
        aria-busy={busy}
        aria-label={strings.nearMe.button}
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <LocateFixed aria-hidden="true" className="mr-1.5 h-4 w-4" />
        )}
        {busy ? strings.nearMe.locating : strings.nearMe.button}
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={locate}
      disabled={busy}
      aria-busy={busy}
      aria-label={strings.nearMe.button}
      title={strings.nearMe.button}
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full border shadow-md transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
        state === 'located'
          ? 'border-blue-600 bg-blue-600 text-white'
          : 'border-neutral-200 bg-white text-neutral-700',
      )}
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
      ) : (
        <LocateFixed aria-hidden="true" className="h-5 w-5" />
      )}
    </button>
  );
}
