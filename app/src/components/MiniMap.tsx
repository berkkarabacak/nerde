// MiniMap — small single-purpose map used on the place page (static strip with
// one marker) and in the Add wizard (center-fixed pin, drag the map to move it).
import { useEffect, useRef, useState } from 'react';
import { Map as MaplibreMap, Marker, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { OSM_RASTER_STYLE } from '@/components/map-style';
import { cn } from '@/lib/utils';

interface MiniMapProps {
  lat: number;
  lng: number;
  zoom?: number;
  className?: string;
  /** Center-fixed pin mode: the map pans under a stationary pin and reports the center. */
  centerPin?: boolean;
  pinColor?: string;
  onCenterChange?: (center: { lat: number; lng: number }) => void;
  /** Called when the (non-centerPin) map is clicked, e.g. to jump back to the main map. */
  onClick?: () => void;
}

export default function MiniMap({
  lat,
  lng,
  zoom = 14,
  className,
  centerPin = false,
  pinColor = '#475569',
  onCenterChange,
  onClick,
}: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const cbRef = useRef({ onCenterChange, onClick });
  useEffect(() => {
    cbRef.current = { onCenterChange, onClick };
  }, [onCenterChange, onClick]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new MaplibreMap({
      container,
      style: OSM_RASTER_STYLE,
      center: [lng, lat],
      zoom,
      minZoom: 2,
      attributionControl: { compact: true },
      interactive: true,
    });
    mapRef.current = map;

    if (centerPin) {
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('move', () => {
        const c = map.getCenter();
        cbRef.current.onCenterChange?.({ lat: c.lat, lng: c.lng });
      });
    } else {
      map.scrollZoom.disable();
      map.on('click', () => cbRef.current.onClick?.());
      let marker: Marker | null = null;
      map.on('load', () => {
        const el = document.createElement('div');
        el.className = 'nerde-mini-marker';
        el.style.background = pinColor;
        marker = new Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
        setLoaded(true);
      });
      void marker;
    }

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Mount once — coordinate updates happen through flyTo below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep view in sync when lat/lng change after mount (e.g. async load).
  const first = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || centerPin) return;
    if (first.current) {
      first.current = false;
      return;
    }
    map.jumpTo({ center: [lng, lat], zoom });
  }, [lat, lng, zoom, centerPin]);

  return (
    <div className={cn('relative', className)}>
      <div ref={containerRef} className="h-full w-full" />
      {centerPin && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full"
          style={{ color: pinColor }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
          </svg>
        </div>
      )}
      {!loaded && !centerPin && (
        <div className="absolute inset-0 animate-pulse bg-neutral-100" aria-hidden="true" />
      )}
    </div>
  );
}
