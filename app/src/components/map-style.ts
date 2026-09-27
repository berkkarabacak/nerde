// Base map style — OSM raster tiles, no token (CONTRACTS §1).
// A glyphs URL is included so the cluster-count symbol layer can render text;
// raster tiles alone carry no fonts.
import type { StyleSpecification } from 'maplibre-gl';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: OSM_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
};
