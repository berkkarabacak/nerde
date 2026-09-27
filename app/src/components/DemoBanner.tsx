// DemoBanner — slim dismissible amber notice shown only in the static demo
// build (VITE_DEMO=1). Renders nothing in normal builds. Dismissal persists in
// localStorage ('nerde:demo-dismissed').
import { useState } from 'react';
import { X } from 'lucide-react';
import { isDemo } from '@/lib/demo';
import { strings } from '@/lib/strings';

const DISMISS_KEY = 'nerde:demo-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // private mode
  }
}

export default function DemoBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!isDemo || dismissed) return null;
  return (
    <div
      role="note"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
    >
      <span className="min-w-0 truncate">{strings.demoBanner}</span>
      <button
        type="button"
        aria-label={strings.map.dismiss}
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(DISMISS_KEY, '1');
          } catch {
            // private mode / quota — dismissal is best-effort
          }
        }}
        className="shrink-0 rounded-full p-0.5 text-amber-700 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
