// Tiny pub/sub so non-map UI (search results, near-me) can request map movement
// even when the map lives in a different part of the tree. The map page
// subscribes on mount and replays any request issued before it mounted.
export interface MapFlyRequest {
  lat: number;
  lng: number;
  zoom?: number;
  seq: number;
}

type Listener = (req: MapFlyRequest) => void;

let pending: MapFlyRequest | null = null;
const listeners = new Set<Listener>();

export const mapBus = {
  flyTo(lat: number, lng: number, zoom?: number): void {
    const req: MapFlyRequest = { lat, lng, zoom, seq: Date.now() + Math.random() };
    pending = req;
    for (const fn of listeners) fn(req);
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    if (pending) {
      fn(pending);
      pending = null;
    }
    return () => {
      listeners.delete(fn);
    };
  },
};
