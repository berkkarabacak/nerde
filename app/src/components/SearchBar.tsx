// Combined search: GET /api/search?q= (categories + places) merged with
// Nominatim geographies (browser-side, ≤1 req/s, attribution in footer).
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { mapBus } from '@/lib/map-bus';
import { track } from '@/lib/events';
import { strings } from '@/lib/strings';
import { useCategories } from '@/lib/categories';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type { PlaceSummary } from '@/lib/api-types';

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  type: string;
}

export default function SearchBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { categories } = useCategories();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [matchedCategories, setMatchedCategories] = useState(categories);
  const [geo, setGeo] = useState<NominatimResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nominatimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNominatimAt = useRef(0);
  const seqRef = useRef(0);

  const trimmed = query.trim();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (nominatimTimerRef.current) clearTimeout(nominatimTimerRef.current);
    if (!trimmed) {
      // Invalidate in-flight requests; stale results are gated on `trimmed`
      // in the render below, so nothing outdated is displayed.
      seqRef.current += 1;
      const t = setTimeout(() => setLoading(false), 0);
      return () => clearTimeout(t);
    }

    debounceRef.current = setTimeout(() => {
      const seq = ++seqRef.current;
      setLoading(true);

      void api
        .search(trimmed)
        .then((res) => {
          if (seq !== seqRef.current) return;
          setPlaces(res.places);
          setMatchedCategories(res.categories);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setPlaces([]);
          setMatchedCategories([]);
        })
        .finally(() => {
          if (seq === seqRef.current) setLoading(false);
        });

      // Nominatim: ≤1 req/s.
      const sinceLast = Date.now() - lastNominatimAt.current;
      const delay = Math.max(0, 1000 - sinceLast);
      nominatimTimerRef.current = setTimeout(() => {
        lastNominatimAt.current = Date.now();
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(trimmed)}`;
        void fetch(url, { headers: { Accept: 'application/json' } })
          .then((res) => (res.ok ? (res.json() as Promise<NominatimResult[]>) : []))
          .then((results) => {
            if (seq !== seqRef.current) return;
            setGeo(results);
          })
          .catch(() => {
            if (seq === seqRef.current) setGeo([]);
          });
      }, delay);

      track('search_performed', { q: trimmed });
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (nominatimTimerRef.current) clearTimeout(nominatimTimerRef.current);
    };
  }, [trimmed, categories]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const pickCategory = (slug: string) => {
    close();
    navigate(`/c/${slug}`);
  };

  const pickPlace = (slug: string) => {
    close();
    navigate(`/place/${slug}`);
  };

  const pickGeo = (result: NominatimResult) => {
    const lat = Number.parseFloat(result.lat);
    const lng = Number.parseFloat(result.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      mapBus.flyTo(lat, lng, 12);
      navigate('/');
    }
    close();
  };

  const onEnter = () => {
    if (geo.length > 0) pickGeo(geo[0]);
  };

  const popular = categories.slice(0, 6);
  const hasResults =
    matchedCategories.length > 0 || places.length > 0 || geo.length > 0;

  const list = (
    <Command shouldFilter={false} className="bg-white">
      <CommandList className="max-h-[60vh]">
        {trimmed && !loading && !hasResults && (
          <CommandEmpty>{strings.search.noResults(trimmed)}</CommandEmpty>
        )}
        {!trimmed && (
          <CommandGroup heading={strings.search.popular}>
            {popular.map((c) => (
              <CommandItem
                key={c.slug}
                value={`cat-${c.slug}`}
                onSelect={() => pickCategory(c.slug)}
                className="min-h-[44px]"
              >
                <span aria-hidden="true" className="mr-2">{c.icon}</span>
                <span>{c.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {trimmed && matchedCategories.length > 0 && (
          <CommandGroup heading={strings.search.groupCategories}>
            {matchedCategories.map((c) => (
              <CommandItem
                key={c.slug}
                value={`cat-${c.slug}`}
                onSelect={() => pickCategory(c.slug)}
                className="min-h-[44px]"
              >
                <span aria-hidden="true" className="mr-2">{c.icon}</span>
                <span>{c.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {trimmed && places.length > 0 && (
          <CommandGroup heading={strings.search.groupPlaces}>
            {places.map((p) => (
              <CommandItem
                key={p.id}
                value={`place-${p.id}`}
                onSelect={() => pickPlace(p.slug)}
                className="min-h-[44px]"
              >
                <span aria-hidden="true" className="mr-2">
                  {p.categories[0]?.icon ?? '📍'}
                </span>
                <span className="flex flex-col">
                  <span>{p.name}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {trimmed && geo.length > 0 && (
          <CommandGroup heading={strings.search.groupGeo}>
            {geo.map((g, i) => (
              <CommandItem
                key={`geo-${i}`}
                value={`geo-${i}-${g.display_name}`}
                onSelect={() => pickGeo(g)}
                className="min-h-[44px]"
              >
                <span aria-hidden="true" className="mr-2">📍</span>
                <span className="flex flex-col">
                  <span className="line-clamp-1">{g.display_name}</span>
                  <span className="text-xs text-neutral-400">{g.type}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );

  const inputEl = (
    <div className="relative flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
      />
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-label={strings.search.placeholder}
        autoFocus={autoFocus}
        value={query}
        placeholder={strings.search.placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
          if (e.key === 'Escape') close();
        }}
        className={cn(
          'h-11 w-full rounded-full border border-neutral-200 bg-white pl-9 pr-9 text-base shadow-sm outline-none',
          'focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
          'md:h-10 md:text-sm',
        )}
      />
      {loading && (
        <Loader2
          aria-hidden="true"
          className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-neutral-400"
        />
      )}
    </div>
  );

  // Mobile: input opens a full-screen dialog with results.
  if (isMobile) {
    return (
      <>
        <div onClick={() => setOpen(true)} className="flex-1">
          {inputEl}
        </div>
        <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
          <DialogContent className="top-0 h-[100dvh] w-full max-w-none translate-y-0 gap-0 rounded-none border-0 p-3 sm:max-w-none">
            <DialogTitle className="sr-only">{strings.search.placeholder}</DialogTitle>
            <div className="mb-2">{inputEl}</div>
            {list}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Desktop: popover anchored under the input.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="flex-1">{inputEl}</div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-w-xl border-neutral-200 p-0 shadow-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={() => setOpen(false)}
      >
        {list}
      </PopoverContent>
    </Popover>
  );
}
