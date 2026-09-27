// NotFound — catch-all 404.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '@/components/EmptyState';
import Footer from '@/components/Footer';
import Header from '@/components/Header';
import OfflineBanner from '@/components/OfflineBanner';
import { Button } from '@/components/ui/button';
import { setMeta } from '@/lib/seo';
import { strings } from '@/lib/strings';

export default function NotFound() {
  useEffect(() => {
    setMeta({
      title: 'Page not found — Nerde',
      robots: 'noindex,follow',
      canonical: '/',
      jsonLd: null,
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <OfflineBanner />
      <Header />
      <main className="flex flex-1 items-center justify-center">
        <EmptyState
          emoji="🧭"
          title="This page doesn't exist."
          action={
            <Button asChild>
              <Link to="/">{strings.errors.backToMap}</Link>
            </Button>
          }
        />
      </main>
      <Footer />
    </div>
  );
}
