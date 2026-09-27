// OfflineBanner — slim persistent banner when the browser goes offline (§9.4).
import { useEffect, useState } from 'react';
import { strings } from '@/lib/strings';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="flex h-8 items-center justify-center bg-neutral-900 text-center text-xs text-white">
      {strings.errors.offline}
    </div>
  );
}
