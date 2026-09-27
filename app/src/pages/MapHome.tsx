// MapHome — `/` and `/c/:slug`. The map is the product: desktop = sidebar + map,
// mobile = full-bleed map + floating controls + snap-point bottom sheet.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Heart, Loader2, LogOut, Map as MapIcon, Menu, Plus, Shield, X } from 'lucide-react';
import { toast } from 'sonner';
import MapView from '@/components/MapView';
import type { FlyToTarget } from '@/components/MapView';
import BottomSheet from '@/components/BottomSheet';
import type { SheetSnap } from '@/components/BottomSheet';
import CategoryChips from '@/components/CategoryChips';
import CityQuickLinks from '@/components/CityQuickLinks';
import DemoBanner from '@/components/DemoBanner';
import CategorySeoBlock from '@/components/CategorySeoBlock';
import type { CategorySeoData } from '@/components/CategorySeoBlock';
import EmptyState from '@/components/EmptyState';
import FilterPanel from '@/components/FilterPanel';
import Footer from '@/components/Footer';
import Header from '@/components/Header';
import NearMeButton from '@/components/NearMeButton';
import OfflineBanner from '@/components/OfflineBanner';
import PlaceCard from '@/components/PlaceCard';
import { PlacePreviewCard } from '@/components/PlacePreviewCard';
import SearchBar from '@/components/SearchBar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { useCategories } from '@/lib/categories';
import { CATEGORY_CONTENT } from '@/lib/category-content';
import { haversineKm } from '@/lib/format';
import { mapBus } from '@/lib/map-bus';
import { setMeta, websiteJsonLd } from '@/lib/seo';
import { strings } from '@/lib/strings';
import { useIsMobile } from '@/hooks/use-mobile';
import type { PlaceSummary } from '@/lib/api-types';

const HOME_TITLE = 'Nerde — Specialized Maps for Specific Places';
const HOME_DESCRIPTION =
  'Where can I find X? Nerde maps the niche places conventional maps miss — calisthenics parks, vanlife spots, arm wrestling clubs, public showers and more.';

export default function MapHome() {
  const { slug } = useParams<{ slug?: string }>();
  const isMobile = useIsMobile();
  const { user, logout } = useAuth();
  const { bySlug, loading: categoriesLoading } = useCategories();

  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<PlaceSummary | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [activeAttrs, setActiveAttrs] = useState<string[]>([]);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [flyTo, setFlyTo] = useState<FlyToTarget | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('peek');
  const [seoData, setSeoData] = useState<CategorySeoData | null>(null);
  // Truncation honesty (CRITICAL_REVIEW I1): when the bbox query samples, show
  // the full count and a "zoom in" hint. Dismissible per category.
  const [sample, setSample] = useState<{ total: number } | null>(null);
  const [sampleDismissed, setSampleDismissed] = useState(false);
  const errorToastShown = useRef(false);

  const category = bySlug(slug);
  const unknownCategory = Boolean(slug) && !categoriesLoading && !category;

  // Category switch clears attribute filters, selection and SEO data.
  // (Render-phase derived state reset — the React-sanctioned pattern.)
  const [prevSlug, setPrevSlug] = useState(slug);
  if (prevSlug !== slug) {
    setPrevSlug(slug);
    setActiveAttrs([]);
    setSelected(null);
    setSeoData(null);
    setSample(null);
    setSampleDismissed(false);
  }

  // External fly-to requests (search geography, etc.).
  useEffect(() => mapBus.subscribe((req) => setFlyTo(req)), []);

  // ---- Per-route SEO metadata (SEO_STRATEGY §4) ----
  useEffect(() => {
    if (unknownCategory) {
      setMeta({
        title: 'Category not found — Nerde',
        robots: 'noindex,follow',
        canonical: '/',
        jsonLd: null,
      });
      return;
    }
    if (!slug) {
      setMeta({
        title: HOME_TITLE,
        description: HOME_DESCRIPTION,
        canonical: '/',
        jsonLd: websiteJsonLd(),
      });
      return;
    }
    if (!category) return;

    const withSuffix = `${category.name} Near You — Nerde`;
    const title = withSuffix.length > 48 ? `${category.name} — Nerde` : withSuffix;
    const filterLabels = category.attributes
      .filter((a) => a.filterable)
      .sort((a, b) => a.sort - b.sort)
      .slice(0, 3)
      .map((a) => a.label.toLowerCase());
    const plural = category.name.toLowerCase();
    const description = seoData
      ? `Find ${seoData.total} ${plural} worldwide. ` +
        (filterLabels.length > 0 ? `Filter by ${filterLabels.join(', ')}. ` : '') +
        'Community-verified, free, updated daily.'
      : `Find ${plural} worldwide. Community-verified, free, updated daily.`;

    const jsonLd: Record<string, unknown>[] = [];
    if (seoData) {
      jsonLd.push({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: category.name,
        url: `https://nerde.com/c/${category.slug}`,
        numberOfItems: seoData.total,
        itemListElement: seoData.topPlaces.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Place',
            name: p.name,
            url: `https://nerde.com/place/${p.slug}`,
            geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng },
          },
        })),
      });
    }
    const faq = CATEGORY_CONTENT[category.slug]?.faq;
    if (faq && faq.length > 0) {
      jsonLd.push({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      });
    }

    setMeta({
      title,
      description,
      canonical: `/c/${category.slug}`,
      jsonLd,
    });
  }, [slug, category, seoData, unknownCategory]);

  const onQueryError = useCallback(() => {
    setFailed(true);
    if (!errorToastShown.current) {
      errorToastShown.current = true;
      toast.error(strings.errors.loadPlaces);
    }
  }, []);

  const retry = useCallback(() => {
    setFailed(false);
    errorToastShown.current = false;
    setReloadKey((n) => n + 1);
  }, []);

  const sortedPlaces = useMemo(() => {
    if (!center) return places;
    return places
      .slice()
      .sort(
        (a, b) =>
          haversineKm(center.lat, center.lng, a.lat, a.lng) -
          haversineKm(center.lat, center.lng, b.lat, b.lng),
      );
  }, [places, center]);

  const distanceTo = useCallback(
    (p: PlaceSummary) => (center ? haversineKm(center.lat, center.lng, p.lat, p.lng) : null),
    [center],
  );

  const selectFromList = useCallback((place: PlaceSummary) => {
    setSelected(place);
    setSheetSnap('peek');
    setFlyTo({ lat: place.lat, lng: place.lng, seq: Date.now() + Math.random() });
  }, []);

  const addLink = center ? `/add?lat=${center.lat.toFixed(6)}&lng=${center.lng.toFixed(6)}` : '/add';
  // P1-02: zero-result viewport → empty state + contribution CTA prefilled with
  // the map center (AddPlace reads the `lat`/`lng` params). Shown ONLY when the
  // bbox query genuinely returned zero — never during loading or after an
  // error. Desktop sidebar + mobile bottom sheet share `listContent`; the map
  // overlay card shows the same state. Category pages keep their dedicated
  // copy (CRITICAL_REVIEW B3 / contract amendment A5).
  const showEmpty = !loading && !failed && places.length === 0;
  const emptyTitle = slug ? strings.map.emptyCategoryTitle : strings.map.emptyAreaTitle;
  const emptyBody = slug ? strings.map.emptyCategoryBody : undefined;
  const emptyCta = slug ? strings.map.emptyCta : strings.map.emptyAreaCta;

  // Dismissible truncation hint (sidebar + mobile sheet).
  const sampleHint = sample && !sampleDismissed && (
    <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span>{strings.map.sampleHint(sample.total)}</span>
      <button
        type="button"
        aria-label={strings.map.dismiss}
        onClick={() => setSampleDismissed(true)}
        className="shrink-0 rounded-full p-1 text-amber-700 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // ---------- shared map element ----------
  const mapElement = (
    <MapView
      cat={slug}
      attrs={activeAttrs}
      selected={selected}
      onSelect={setSelected}
      onPlaces={(p) => {
        setPlaces(p);
        setFailed(false);
        errorToastShown.current = false;
      }}
      onQueryMeta={(m) => setSample(m.truncated ? { total: m.totalCount } : null)}
      onLoadingChange={setLoading}
      onQueryError={onQueryError}
      onCenterChange={setCenter}
      hoveredId={hoveredId}
      flyToTarget={flyTo}
      userLocation={userLocation}
      showPopup={!isMobile}
      reloadKey={reloadKey}
    />
  );

  const updatingPill = loading && places.length > 0 && (
    <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-neutral-600 shadow-md">
      <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      {strings.map.updating}
    </div>
  );

  const emptyCard = showEmpty && (
    <div className="absolute left-1/2 top-1/2 z-10 w-64 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 bg-white p-4 text-center shadow-lg">
      <p className="text-sm font-semibold text-neutral-900">{emptyTitle}</p>
      {emptyBody && <p className="mt-0.5 text-sm text-neutral-600">{emptyBody}</p>}
      <Button asChild size="sm" className="mt-3">
        <Link to={addLink}>{emptyCta}</Link>
      </Button>
    </div>
  );

  const listContent = (
    <div className="space-y-2 p-3">
      {sampleHint}
      {loading && places.length === 0 &&
        Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3 rounded-lg border border-neutral-200 bg-white p-3">
            <Skeleton className="h-16 w-16 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      {failed && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {strings.errors.loadPlaces}
          <Button variant="outline" size="sm" onClick={retry} className="ml-2">
            {strings.errors.retry}
          </Button>
        </div>
      )}
      {showEmpty && (
        <EmptyState
          title={emptyTitle}
          body={emptyBody}
          action={
            <Button asChild size="sm">
              <Link to={addLink}>{emptyCta}</Link>
            </Button>
          }
        />
      )}
      {!loading &&
        sortedPlaces.map((p) => (
          <PlaceCard
            key={p.id}
            place={p}
            distanceKm={distanceTo(p)}
            selected={selected?.id === p.id}
            onSelect={selectFromList}
            onHover={setHoveredId}
          />
        ))}
    </div>
  );

  // ---------- unknown category → 404 ----------
  if (unknownCategory) {
    return (
      <div className="flex min-h-screen flex-col">
        <OfflineBanner />
        <Header />
        <main className="flex flex-1 items-center justify-center">
          <EmptyState
            emoji="🗺️"
            title="This category doesn't exist."
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

  // ---------- mobile shell ----------
  if (isMobile) {
    return (
      <div className="flex flex-col">
        <OfflineBanner />
        <DemoBanner />
        <section className="relative h-[100dvh] w-full overflow-hidden">
          <div className="absolute inset-0">{mapElement}</div>

          {/* floating search + city quick-links (UX_REVIEW F1) */}
          <div className="absolute inset-x-0 top-0 z-10 px-3 pt-3">
            <div className="flex items-start gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Menu"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                >
                  <Menu aria-hidden="true" className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64">
                <SheetHeader>
                  <SheetTitle className="text-left text-lg font-semibold">
                    Nerde <span aria-hidden="true">📍</span>
                  </SheetTitle>
                </SheetHeader>
                <nav className="mt-4 flex flex-col gap-1">
                  <Link
                    to="/saved"
                    className="flex min-h-[44px] items-center gap-2 rounded-md px-2 text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    <Heart aria-hidden="true" className="h-4 w-4" /> Saved
                  </Link>
                  <Link
                    to="/add"
                    className="flex min-h-[44px] items-center gap-2 rounded-md px-2 text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    <Plus aria-hidden="true" className="h-4 w-4" /> Add Place
                  </Link>
                  <Link
                    to="/"
                    className="flex min-h-[44px] items-center gap-2 rounded-md px-2 text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    <MapIcon aria-hidden="true" className="h-4 w-4" /> Map
                  </Link>
                  {user?.role === 'admin' && (
                    <Link
                      to="/admin"
                      className="flex min-h-[44px] items-center gap-2 rounded-md px-2 text-sm text-neutral-700 hover:bg-neutral-100"
                    >
                      <Shield aria-hidden="true" className="h-4 w-4" /> Admin
                    </Link>
                  )}
                  {user ? (
                    <button
                      type="button"
                      onClick={() => void logout()}
                      className="flex min-h-[44px] items-center gap-2 rounded-md px-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
                    >
                      <LogOut aria-hidden="true" className="h-4 w-4" /> {strings.auth.logout} (@
                      {user.username})
                    </button>
                  ) : (
                    <Link
                      to="/login"
                      className="flex min-h-[44px] items-center gap-2 rounded-md px-2 text-sm font-medium text-blue-600 hover:bg-neutral-100"
                    >
                      Log in
                    </Link>
                  )}
                </nav>
                <p className="mt-6 px-2 text-[11px] text-neutral-400">
                  {strings.map.attribution} · Search by OpenStreetMap Nominatim
                </p>
              </SheetContent>
            </Sheet>
            <SearchBar />
            </div>
            <CityQuickLinks className="ml-14 mt-1.5" />
          </div>

          {/* category pills */}
          <div className="absolute inset-x-0 top-24 z-10 px-3">
            <CategoryChips activeSlug={slug} variant="pills" />
          </div>

          {/* FABs */}
          <div className="absolute bottom-40 right-3 z-10 flex flex-col items-center gap-3">
            {category && (
              <FilterPanel category={category} activeAttrs={activeAttrs} onChange={setActiveAttrs} triggerVariant="fab" />
            )}
            <NearMeButton
              onLocated={(coords) => {
                setUserLocation(coords);
                setFlyTo({ ...coords, zoom: 14, seq: Date.now() + Math.random() });
              }}
            />
            <Link
              to={addLink}
              aria-label="Add a place"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <Plus aria-hidden="true" className="h-6 w-6" />
            </Link>
          </div>

          {updatingPill}
          {emptyCard}

          {/* selected preview card above the sheet */}
          {selected && (
            <div className="absolute bottom-[9.5rem] left-3 z-20">
              <PlacePreviewCard
                place={selected}
                distanceKm={distanceTo(selected)}
                onClose={() => setSelected(null)}
              />
            </div>
          )}

          <BottomSheet
            snap={sheetSnap}
            onSnapChange={setSheetSnap}
            peekContent={
              <span className="flex min-w-0 flex-col items-center">
                {/* UX_REVIEW F3: never "0 places in this area" before the first
                    successful bbox query — show a neutral hint while loading. */}
                <span className="max-w-[300px] truncate">
                  {loading && places.length === 0
                    ? strings.map.exploreHint
                    : `● ${strings.map.placesInArea(places.length)}${sortedPlaces[0] ? ` · ${sortedPlaces[0].name}` : ''}`}
                </span>
                {/* UX_REVIEW F4: subtle one-line pitch in the peek row. */}
                <span className="max-w-[300px] truncate text-[11px] text-neutral-400">
                  {strings.map.tagline}
                </span>
              </span>
            }
          >
            {category && (
              <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-3 py-2">
                <FilterPanel category={category} activeAttrs={activeAttrs} onChange={setActiveAttrs} />
              </div>
            )}
            {listContent}
          </BottomSheet>
        </section>

        {category && (
          <CategorySeoBlock
            category={category}
            onSeoData={(d) => {
              if (!seoData || seoData.total !== d.total) setSeoData(d);
            }}
          />
        )}
        <Footer />
      </div>
    );
  }

  // ---------- desktop shell ----------
  return (
    <div className="flex min-h-screen flex-col">
      <OfflineBanner />
      <Header />
      <DemoBanner />
      <div className="flex h-11 shrink-0 items-center border-b border-neutral-200 bg-white px-4">
        <CategoryChips activeSlug={slug} variant="rail" />
      </div>

      <section className="flex h-[calc(100vh-6.25rem)] min-h-[420px]">
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-neutral-200 bg-white">
          {/* UX_REVIEW F4 + F1: one-line pitch + city quick-links under the header search */}
          <div className="space-y-1 border-b border-neutral-200 px-3 py-2">
            <p className="text-xs text-neutral-500">{strings.map.tagline}</p>
            <CityQuickLinks />
          </div>
          <div className="flex items-center gap-2 border-b border-neutral-200 p-3">
            <FilterPanel category={category} activeAttrs={activeAttrs} onChange={setActiveAttrs} />
            <NearMeButton
              variant="button"
              onLocated={(coords) => {
                setUserLocation(coords);
                setFlyTo({ ...coords, zoom: 14, seq: Date.now() + Math.random() });
              }}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{listContent}</div>
          <div className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500">
            {loading && places.length === 0
              ? strings.map.exploreHint
              : strings.map.placesInArea(places.length)}
          </div>
        </aside>

        <div className="relative flex-1">
          {mapElement}
          {updatingPill}
          {emptyCard}
        </div>
      </section>

      {category && (
        <CategorySeoBlock
          category={category}
          onSeoData={(d) => {
            if (!seoData || seoData.total !== d.total) setSeoData(d);
          }}
        />
      )}
      <Footer />
    </div>
  );
}
