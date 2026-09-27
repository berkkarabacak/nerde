// Analytics events — POST /api/events, fire-and-forget, never blocks UI (CONTRACTS §6).
import { isDemo } from './demo';
import type { EventType } from './api-types';

const CLIENT_ID_KEY = 'nerde_client_id';
const REFERRER_KEY = 'nerde_referrer_sent';

function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

/**
 * Fire an analytics event. `meta.cat` should carry the category slug on
 * category-scoped events. referrer_host is attached once per session.
 */
export function track(type: EventType, meta: Record<string, unknown> = {}): void {
  // Demo build: no server to receive events — drop them silently.
  if (isDemo) return;
  try {
    const payload: Record<string, unknown> = { ...meta };
    if (!sessionStorage.getItem(REFERRER_KEY)) {
      sessionStorage.setItem(REFERRER_KEY, '1');
      if (document.referrer) {
        try {
          payload.referrer_host = new URL(document.referrer).host;
        } catch {
          /* ignore malformed referrer */
        }
      }
    }
    // client_id travels TOP-LEVEL (contract amendment, CRITICAL_REVIEW I2):
    // the server reads body.client_id directly; nesting it in meta silently
    // stored NULL and killed the returning-user metric.
    void fetch('/api/events', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, client_id: getClientId(), meta: payload }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics must never break the UI */
  }
}
