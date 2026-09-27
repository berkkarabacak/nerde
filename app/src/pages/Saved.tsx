// Saved — /saved. Grid of saved PlaceCards; auth-gated (§6.6).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '@/components/EmptyState';
import Footer from '@/components/Footer';
import Header from '@/components/Header';
import OfflineBanner from '@/components/OfflineBanner';
import PlaceCard from '@/components/PlaceCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setMeta } from '@/lib/seo';
import { strings } from '@/lib/strings';
import type { PlaceSummary } from '@/lib/api-types';

export default function Saved() {
  const { user, loading: authLoading } = useAuth();
  const [places, setPlaces] = useState<PlaceSummary[] | null>(null);

  useEffect(() => {
    setMeta({
      title: 'Saved places — Nerde',
      robots: 'noindex,follow',
      canonical: '/saved',
      jsonLd: null,
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .mySaved()
      .then((res) => {
        if (!cancelled) setPlaces(res.places);
      })
      .catch(() => {
        if (!cancelled) setPlaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <OfflineBanner />
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">
        <h1 className="text-xl font-semibold text-neutral-900">{strings.saved.title}</h1>

        {authLoading || (user && places === null) ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : !user ? (
          <EmptyState
            emoji="♡"
            title={strings.saved.loggedOut}
            action={
              <Button asChild>
                <Link to="/login?next=%2Fsaved">Log in</Link>
              </Button>
            }
          />
        ) : places && places.length === 0 ? (
          <EmptyState
            emoji="♡"
            title={strings.saved.empty}
            action={
              <Button asChild>
                <Link to="/">{strings.saved.explore}</Link>
              </Button>
            }
          />
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(places ?? []).map((p) => (
              <PlaceCard key={p.id} place={p} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
