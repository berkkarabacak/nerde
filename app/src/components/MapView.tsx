// MapView — the map-first core of Nerde.
// MapLibre GL + OSM raster tiles, supercluster GeoJSON source fed by
// GET /api/places?bbox=... on moveend (debounced 300ms). Never loads all places.
import { useCallback, useEffect, useRef, useState } from 'react';
import { GeoJSONSource, Map as MaplibreMap, Marker, NavigationControl, Popup } from 'maplibre-gl';
import type { MapLayerMouseEvent } from 'maplibre-gl';
import { createRoot } from 'react-dom/client';
import type { Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { OSM_RASTER_STYLE } from '@/components/map-style';
import { PlacePreviewCard } from '@/components/PlacePreviewCard';
import { demoApi, isDemo } from '@/lib/demo';
import { haversineKm } from '@/lib/format';
import type { PlaceSummary, PlacesListResponse } from '@/lib/api-types';

export interface FlyToTarget {
  lat: number;
  lng: number;
  zoom?: number;
  seq: number; // bump to re-trigger
}

interface MapViewProps {
  cat?: string;
  attrs: string[];
  selected: PlaceSummary | null;
  onSelect: (place: PlaceSummary | null) => void;
  onPlaces: (places: PlaceSummary[]) => void;
  /** bbox query meta: full count + truncation flag (CRITICAL_REVIEW I1). */
  onQueryMeta?: (meta: { totalCount: number; truncated: boolean }) => void;
  onLoadingChange?: (loading: boolean) => void;
  onQueryError?: () => void;
  onCenterChange?: (center: { lat: number; lng: number }) => void;
  hoveredId?: number | null;
  flyToTarget?: FlyToTarget | null;
  userLocation?: { lat: number; lng: number } | null;
  /** Desktop: preview opens as a MapLibre Popup. Mobile: parent renders the card. */
  showPopup: boolean;
  /** Bump to force a refetch of the current bbox (error retry). */
  reloadKey?: number;
  className?: string;
}

const CLUSTER_COLOR = '#2563EB';
const FALLBACK_COLOR = '#475569';

// First-paint default (UX_REVIEW F1): frame Europe + Türkiye, where the seed
// data is densest, so clusters are visible immediately instead of an empty-
// looking world view. Returning users restore their last position instead.
const DEFAULT_CENTER: [number, number] = [20, 46]; // [lng, lat]
const DEFAULT_ZOOM = 4;
const VIEW_STORAGE_KEY = 'nerde:map-view';

/** Read the persisted map view; null when missing/invalid/out of range. */
function readSavedView(): { center: [number, number]; zoom: number } | null {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { lng?: unknown; lat?: unknown; zoom?: unknown };
    if (typeof v.lng !== 'number' || typeof v.lat !== 'number' || typeof v.zoom !== 'number') return null;
    if (v.lat < -90 || v.lat > 90 || v.lng < -180 || v.lng > 180) return null;
    if (v.zoom < 2 || v.zoom > 22) return null;
    return { center: [v.lng, v.lat], zoom: v.zoom };
  } catch {
    return null; // private mode / corrupted value
  }
}

export default function MapView({
  cat,
  attrs,
  selected,
  onSelect,
  onPlaces,
  onQueryMeta,
  onLoadingChange,
  onQueryError,
  onCenterChange,
  hoveredId,
  flyToTarget,
  userLocation,
  showPopup,
  reloadKey = 0,
  className,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const placesById = useRef(new Map<number, PlaceSummary>());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const popupRootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  const popupCloseGuard = useRef(false);
  const userMarkerRef = useRef<Marker | null>(null);
  const persistRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest callbacks in refs so map event handlers never go stale.
  const cbRef = useRef({ onSelect, onPlaces, onQueryMeta, onLoadingChange, onQueryError, onCenterChange });
  useEffect(() => {
    cbRef.current = { onSelect, onPlaces, onQueryMeta, onLoadingChange, onQueryError, onCenterChange };
  }, [onSelect, onPlaces, onQueryMeta, onLoadingChange, onQueryError, onCenterChange]);
  const queryRef = useRef<() => void>(() => {});

  const runQuery = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    cbRef.current.onLoadingChange?.(true);

    const p = new URLSearchParams({ bbox, limit: '500' });
    if (cat) p.set('cat', cat);
    if (attrs.length > 0) p.set('attrs', attrs.join(','));

    // Demo build: the bbox query is served from baked JSON instead of the API.
    const query = `/api/places?${p.toString()}`;
    const request: Promise<PlacesListResponse> = isDemo
      ? demoApi<PlacesListResponse>('GET', query)
      : fetch(query, { credentials: 'include', signal: controller.signal }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<PlacesListResponse>;
        });
    request
      .then((data) => {
        placesById.current = new Map(data.places.map((pl) => [pl.id, pl]));
        const source = map.getSource('places') as GeoJSONSource | undefined;
        if (source) {
          source.setData({
            type: 'FeatureCollection',
            features: data.places.map((pl) => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [pl.lng, pl.lat] },
              properties: {
                id: pl.id,
                slug: pl.slug,
                name: pl.name,
                color: pl.categories[0]?.color ?? FALLBACK_COLOR,
              },
            })),
          });
        }
        cbRef.current.onPlaces(data.places);
        cbRef.current.onQueryMeta?.({ totalCount: data.total_count, truncated: data.truncated });
        cbRef.current.onLoadingChange?.(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        cbRef.current.onLoadingChange?.(false);
        cbRef.current.onQueryError?.();
      });
  }, [cat, attrs]);

  useEffect(() => {
    queryRef.current = runQuery;
  }, [runQuery]);

  // ---- Map lifecycle (mount once) ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const savedView = readSavedView();
    const map = new MaplibreMap({
      container,
      style: OSM_RASTER_STYLE,
      center: savedView?.center ?? DEFAULT_CENTER,
      zoom: savedView?.zoom ?? DEFAULT_ZOOM,
      minZoom: 2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

    map.on('load', () => {
      map.addSource('places', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'places',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': CLUSTER_COLOR,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16,
            10,
            20,
            50,
            24,
          ],
        },
      });

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'places',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });

      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'places',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['coalesce', ['get', 'color'], FALLBACK_COLOR],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-radius': 9,
        },
      });

      // Selected + hovered highlight rings (filtered per-state).
      map.addLayer({
        id: 'hover-highlight',
        type: 'circle',
        source: 'places',
        filter: ['==', ['get', 'id'], -1],
        paint: {
          'circle-color': 'rgba(37, 99, 235, 0.12)',
          'circle-stroke-color': CLUSTER_COLOR,
          'circle-stroke-width': 2,
          'circle-radius': 13,
        },
      });
      map.addLayer({
        id: 'selected-highlight',
        type: 'circle',
        source: 'places',
        filter: ['==', ['get', 'id'], -1],
        paint: {
          'circle-color': 'rgba(37, 99, 235, 0.18)',
          'circle-stroke-color': CLUSTER_COLOR,
          'circle-stroke-width': 2.5,
          'circle-radius': 14,
        },
      });

      // Interactions
      map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const clusterId = feature.properties?.cluster_id as number;
        const source = map.getSource('places') as GeoJSONSource;
        source
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            const coords = (feature.geometry as Point).coordinates as [number, number];
            map.easeTo({ center: coords, zoom, duration: 200 });
          })
          .catch(() => {});
      });

      map.on('click', 'unclustered-point', (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const id = feature.properties?.id as number;
        const place = placesById.current.get(id);
        if (!place) return;
        const coords = (feature.geometry as Point).coordinates as [number, number];
        map.easeTo({ center: coords, duration: 200 });
        cbRef.current.onSelect(place);
      });

      map.on('click', (e: MapLayerMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['unclustered-point', 'clusters'],
        });
        if (hits.length === 0) cbRef.current.onSelect(null);
      });

      for (const layer of ['clusters', 'unclustered-point']) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      map.on('moveend', () => {
        const center = map.getCenter();
        cbRef.current.onCenterChange?.({ lat: center.lat, lng: center.lng });
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => queryRef.current(), 300);
        // Persist last position (debounced) so returning users land where they left.
        if (persistRef.current) clearTimeout(persistRef.current);
        persistRef.current = setTimeout(() => {
          try {
            const c = map.getCenter();
            localStorage.setItem(
              VIEW_STORAGE_KEY,
              JSON.stringify({ lng: c.lng, lat: c.lat, zoom: map.getZoom() }),
            );
          } catch {
            // private mode / quota — persistence is best-effort
          }
        }, 400);
      });

      setReady(true);
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (persistRef.current) clearTimeout(persistRef.current);
      abortRef.current?.abort();
      popupRootRef.current?.unmount();
      popupRef.current?.remove();
      userMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ---- Initial query once ready ----
  useEffect(() => {
    if (ready) queryRef.current();
  }, [ready]);

  // ---- Manual reload (error retry) ----
  const prevReloadKey = useRef(reloadKey);
  useEffect(() => {
    if (!ready) return;
    if (prevReloadKey.current !== reloadKey) {
      prevReloadKey.current = reloadKey;
      queryRef.current();
    }
  }, [ready, reloadKey]);

  // ---- Refetch when category/filters change ----
  const attrsKey = attrs.join(',');
  const prevQueryKey = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const key = `${cat ?? ''}|${attrsKey}`;
    if (prevQueryKey.current !== null && prevQueryKey.current !== key) {
      queryRef.current();
    }
    prevQueryKey.current = key;
  }, [ready, cat, attrsKey]);

  // ---- Selection highlight ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter('selected-highlight', ['==', ['get', 'id'], selected?.id ?? -1]);
  }, [ready, selected?.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter('hover-highlight', ['==', ['get', 'id'], hoveredId ?? -1]);
  }, [ready, hoveredId]);

  // ---- Preview popup (desktop) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    popupRootRef.current?.unmount();
    popupRootRef.current = null;
    popupRef.current?.remove();
    popupRef.current = null;

    if (!selected || !showPopup) return;

    const el = document.createElement('div');
    const root = createRoot(el);
    const center = map.getCenter();
    root.render(
      <PlacePreviewCard
        place={selected}
        distanceKm={haversineKm(center.lat, center.lng, selected.lat, selected.lng)}
        onClose={() => cbRef.current.onSelect(null)}
      />,
    );
    popupRootRef.current = root;

    const popup = new Popup({ closeButton: false, maxWidth: '280px', offset: 14 })
      .setLngLat([selected.lng, selected.lat])
      .setDOMContent(el)
      .addTo(map);
    popup.on('close', () => {
      if (!popupCloseGuard.current) cbRef.current.onSelect(null);
    });
    popupRef.current = popup;

    return () => {
      popupCloseGuard.current = true;
      popupRootRef.current?.unmount();
      popupRootRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      popupCloseGuard.current = false;
    };
  }, [ready, selected, showPopup]);

  // ---- Fly-to requests ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyToTarget) return;
    map.flyTo({
      center: [flyToTarget.lng, flyToTarget.lat],
      ...(flyToTarget.zoom !== undefined ? { zoom: flyToTarget.zoom } : {}),
    });
  }, [ready, flyToTarget]);

  // ---- User location dot ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (!userLocation) return;

    const el = document.createElement('div');
    el.className = 'nerde-user-dot';
    el.setAttribute('aria-hidden', 'true');
    userMarkerRef.current = new Marker({ element: el })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(map);
  }, [ready, userLocation]);

  return <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }} />;
}
