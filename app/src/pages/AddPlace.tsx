// AddPlace — /add?lat=&lng= 5-step wizard: pin → categories → info → photos → review.
// Guest submission allowed; honeypot `website`; duplicate scan on submit (409)
// and pre-check on pin confirm (DESIGN_SYSTEM §6.4).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import Footer from '@/components/Footer';
import { Logo } from '@/components/Header';
import MiniMap from '@/components/MiniMap';
import OfflineBanner from '@/components/OfflineBanner';
import { CategoryDot, VerifiedLine } from '@/components/place-bits';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCategories } from '@/lib/categories';
import { track } from '@/lib/events';
import { formatDistance } from '@/lib/format';
import { setMeta } from '@/lib/seo';
import { strings } from '@/lib/strings';
import { cn } from '@/lib/utils';
import type { Category, PlaceSummary } from '@/lib/api-types';

type AttrValue = boolean | number | string;

interface ResizedPhoto {
  dataUrl: string;
  name: string;
}

async function resizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}

interface ReverseGeocode {
  address: string;
  city: string;
  country: string;
  country_code: string;
}

export default function AddPlace() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { categories, loading: categoriesLoading } = useCategories();

  const initialLat = Number.parseFloat(params.get('lat') ?? '');
  const initialLng = Number.parseFloat(params.get('lng') ?? '');
  const hasInitial =
    Number.isFinite(initialLat) && Number.isFinite(initialLng);

  const [step, setStep] = useState(1);
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({
    lat: hasInitial ? initialLat : 41.0,
    lng: hasInitial ? initialLng : 28.95,
  });
  const [geo, setGeo] = useState<ReverseGeocode>({ address: '', city: '', country: '', country_code: '' });
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [attrs, setAttrs] = useState<Record<string, AttrValue>>({});
  const [photos, setPhotos] = useState<ResizedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<(PlaceSummary & { distance_km?: number })[] | null>(null);
  const [prechecking, setPrechecking] = useState(false);
  const websiteRef = useRef<HTMLInputElement>(null); // honeypot

  useEffect(() => {
    setMeta({
      title: 'Add a place — Nerde',
      robots: 'noindex,follow',
      canonical: '/add',
      jsonLd: null,
    });
    track('add_place_started');
  }, []);

  const selectedCategories = useMemo(
    () => selectedCats.map((s) => categories.find((c) => c.slug === s)).filter((c): c is Category => Boolean(c)),
    [selectedCats, categories],
  );

  // ---------- step 1: confirm location → reverse geocode + duplicate pre-check ----------
  const confirmLocation = async () => {
    setPrechecking(true);
    // Reverse geocode (best effort — never blocks the flow).
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lng}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = (await res.json()) as {
          display_name?: string;
          address?: Record<string, string>;
        };
        const a = data.address ?? {};
        setGeo({
          address: data.display_name ?? '',
          city: a.city ?? a.town ?? a.village ?? a.municipality ?? '',
          country: a.country ?? '',
          country_code: (a.country_code ?? '').toUpperCase(),
        });
      }
    } catch {
      /* best effort */
    }
    // Duplicate pre-check (≤100 m).
    try {
      const near = await api.placesNear(coords.lat, coords.lng, 0.1);
      if (near.places.length > 0) {
        setDuplicates(near.places);
        setPrechecking(false);
        return;
      }
    } catch {
      /* server scan on submit is the safety net */
    }
    setPrechecking(false);
    setStep(2);
  };

  // ---------- submit ----------
  const submit = useCallback(
    async (force: boolean) => {
      if (submitting) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const cleanAttrs: Record<string, AttrValue> = {};
        for (const [k, v] of Object.entries(attrs)) {
          if (v === true || (typeof v === 'string' && v.trim() !== '') || typeof v === 'number') {
            cleanAttrs[k] = typeof v === 'string' ? v.trim() : v;
          }
        }
        const res = await api.createPlace({
          name: name.trim(),
          description: description.trim(),
          lat: coords.lat,
          lng: coords.lng,
          categories: selectedCats,
          attrs: cleanAttrs,
          address: geo.address.trim() || undefined,
          city: geo.city.trim() || undefined,
          country: geo.country.trim() || undefined,
          country_code: geo.country_code.trim() || undefined,
          force,
          website: websiteRef.current?.value ?? '',
        });
        // Photos upload after creation; failures don't block the success path.
        // Photos require an account (server returns 401 for guests) — guests
        // never reach the picker, but guard here as well.
        if (user) {
          for (const photo of photos) {
            try {
              await api.uploadPhoto(res.place.id, photo.dataUrl);
            } catch {
              toast.error(`Couldn't upload photo "${photo.name}".`);
            }
          }
        }
        track('place_submitted', { place_id: res.place.id, cat: selectedCats[0] });
        toast.success(strings.add.successToast);
        navigate(`/place/${res.place.slug}`);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 409 && err.data.duplicates) {
          setDuplicates(err.data.duplicates);
        } else {
          setSubmitError(err instanceof ApiRequestError ? err.message : strings.errors.generic);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [attrs, coords, description, geo, name, navigate, photos, selectedCats, submitting, user],
  );

  const setAttr = (key: string, value: AttrValue | null) => {
    setAttrs((prev) => {
      const next = { ...prev };
      if (value === null || value === false || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const nameValid = name.trim().length >= 2 && name.trim().length <= 80;
  const stepValid =
    (step === 2 && selectedCats.length > 0) || (step === 3 && nameValid) || step === 1 || step >= 4;

  const onPhotoPick = async (files: FileList | null) => {
    if (!files) return;
    setPhotoError(null);
    for (const file of Array.from(files).slice(0, 6 - photos.length)) {
      try {
        const dataUrl = await resizeImage(file);
        if (dataUrl.length > 4_000_000) {
          setPhotoError(`"${file.name}" is too large even after resizing.`);
          continue;
        }
        setPhotos((prev) => [...prev, { dataUrl, name: file.name }]);
      } catch {
        setPhotoError(`Couldn't read "${file.name}".`);
      }
    }
  };

  const pinColor = selectedCategories[0]?.color ?? '#475569';

  return (
    <div className="flex min-h-[100dvh] flex-col bg-neutral-50">
      <OfflineBanner />
      <header className="flex h-14 shrink-0 items-center border-b border-neutral-200 bg-white px-4">
        <Logo />
      </header>

      <main className="flex flex-1 items-stretch justify-center md:items-center md:p-6">
        <div className="flex w-full flex-col border-neutral-200 bg-white md:max-w-lg md:rounded-lg md:border md:shadow-lg">
          {/* stepper header */}
          <div className="border-b border-neutral-200 p-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => (step === 1 ? navigate(-1) : setStep((s) => s - 1))}
                className="inline-flex min-h-[44px] items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900 md:min-h-0"
                aria-label={strings.add.back}
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                {strings.add.back}
              </button>
              <p className="text-sm font-semibold text-neutral-900">{strings.add.title}</p>
              <span className="text-xs text-neutral-400">{strings.add.step(step)}</span>
            </div>
            <div className="mt-2 flex items-center gap-1" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => (
                <div
                  key={n}
                  className={cn(
                    'h-1 flex-1 rounded-full',
                    n <= step ? 'bg-blue-600' : 'bg-neutral-200',
                  )}
                />
              ))}
            </div>
          </div>

          {submitError && (
            <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
              {submitError}
            </div>
          )}

          {/* ---------- step 1: location ---------- */}
          {step === 1 && (
            <div className="flex flex-1 flex-col">
              <div className="space-y-1 p-4 pb-2">
                <h1 className="text-sm font-semibold text-neutral-900">{strings.add.step1Title}</h1>
                <p className="text-sm text-neutral-600">{strings.add.step1Hint}</p>
              </div>
              <MiniMap
                lat={coords.lat}
                lng={coords.lng}
                zoom={hasInitial ? 16 : 13}
                centerPin
                pinColor={pinColor}
                onCenterChange={setCoords}
                className="min-h-[40vh] flex-1 md:h-[50vh] md:min-h-0 md:flex-none"
              />
              <div className="space-y-2 p-4">
                <p className="font-mono text-xs text-neutral-500" aria-live="polite">
                  {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                </p>
                <Button
                  className="w-full"
                  onClick={() => void confirmLocation()}
                  disabled={prechecking}
                >
                  {prechecking && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
                  {strings.add.confirmLocation}
                </Button>
              </div>
            </div>
          )}

          {/* ---------- step 2: categories ---------- */}
          {step === 2 && (
            <div className="flex flex-1 flex-col p-4">
              <h1 className="text-sm font-semibold text-neutral-900">{strings.add.step2Title}</h1>
              <p className="text-sm text-neutral-600">{strings.add.step2Hint}</p>
              {categoriesLoading ? (
                <p className="mt-4 text-sm text-neutral-500">{strings.search.loading}</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 overflow-y-auto md:grid-cols-3">
                  {categories.map((c) => {
                    const active = selectedCats.includes(c.slug);
                    return (
                      <button
                        key={c.slug}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setSelectedCats((prev) =>
                            active ? prev.filter((s) => s !== c.slug) : [...prev, c.slug],
                          )
                        }
                        className={cn(
                          'flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-lg border p-3 text-center',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
                          active ? 'border-2 bg-white' : 'border-neutral-200 bg-white hover:bg-neutral-50',
                        )}
                        style={active ? { borderColor: c.color } : undefined}
                      >
                        <span aria-hidden="true" className="text-2xl">{c.icon}</span>
                        <span className="flex items-center gap-1 text-sm text-neutral-700">
                          {active && <CategoryDot color={c.color} />}
                          {c.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ---------- step 3: info ---------- */}
          {step === 3 && (
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <h1 className="text-sm font-semibold text-neutral-900">{strings.add.step3Title}</h1>
              <div className="space-y-1.5">
                <Label htmlFor="place-name">
                  {strings.add.nameLabel} <span aria-hidden="true">*</span>
                </Label>
                <Input
                  id="place-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={strings.add.namePlaceholder}
                  maxLength={80}
                  required
                  aria-describedby="name-hint"
                />
                {name.length > 0 && !nameValid && (
                  <p id="name-hint" className="text-xs text-red-600">
                    Name must be 2–80 characters.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-desc">{strings.add.descriptionLabel}</Label>
                <Textarea
                  id="place-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={strings.add.descriptionPlaceholder}
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-address">{strings.add.addressLabel}</Label>
                <Input
                  id="place-address"
                  value={geo.address}
                  onChange={(e) => setGeo((g) => ({ ...g, address: e.target.value }))}
                />
              </div>

              {selectedCategories.map((cat) => (
                <div key={cat.slug} className="space-y-2">
                  <p className="text-xs font-medium text-neutral-500">
                    <span aria-hidden="true" className="mr-1">{cat.icon}</span>
                    {cat.name}
                  </p>
                  <div className="space-y-2">
                    {cat.attributes
                      .slice()
                      .sort((a, b) => a.sort - b.sort)
                      .map((attr) => {
                        const fullKey = `${cat.slug}.${attr.key}`;
                        const value = attrs[fullKey];
                        if (attr.type === 'bool') {
                          const on = value === true;
                          return (
                            <button
                              key={attr.key}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setAttr(fullKey, on ? null : true)}
                              className={cn(
                                'mr-1.5 inline-flex min-h-[36px] items-center rounded-full border px-3 py-1 text-sm',
                                on
                                  ? 'border-2 bg-white text-neutral-900'
                                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50',
                              )}
                              style={on ? { borderColor: cat.color } : undefined}
                            >
                              {attr.label}
                            </button>
                          );
                        }
                        if (attr.type === 'enum') {
                          return (
                            <div key={attr.key} className="space-y-1">
                              <Label htmlFor={`attr-${fullKey}`} className="text-xs">
                                {attr.label}
                              </Label>
                              <Select
                                value={typeof value === 'string' ? value : ''}
                                onValueChange={(v) => setAttr(fullKey, v)}
                              >
                                <SelectTrigger id={`attr-${fullKey}`}>
                                  <SelectValue placeholder="Select…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(attr.options ?? []).map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                      {opt.replace(/_/g, ' ')}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        }
                        if (attr.type === 'number') {
                          return (
                            <div key={attr.key} className="space-y-1">
                              <Label htmlFor={`attr-${fullKey}`} className="text-xs">
                                {attr.label}
                              </Label>
                              <Input
                                id={`attr-${fullKey}`}
                                type="number"
                                inputMode="decimal"
                                value={typeof value === 'number' ? String(value) : ''}
                                onChange={(e) => {
                                  const n = Number.parseFloat(e.target.value);
                                  setAttr(fullKey, Number.isFinite(n) ? n : null);
                                }}
                              />
                            </div>
                          );
                        }
                        return (
                          <div key={attr.key} className="space-y-1">
                            <Label htmlFor={`attr-${fullKey}`} className="text-xs">
                              {attr.label}
                            </Label>
                            <Input
                              id={`attr-${fullKey}`}
                              value={typeof value === 'string' ? value : ''}
                              onChange={(e) => setAttr(fullKey, e.target.value)}
                            />
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ---------- step 4: photos ---------- */}
          {step === 4 && (
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h1 className="text-sm font-semibold text-neutral-900">{strings.add.step4Title}</h1>
              {user ? (
                <>
                  <label
                    htmlFor="photo-input"
                    className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600 hover:border-neutral-400"
                  >
                    <ImagePlus aria-hidden="true" className="h-6 w-6 text-neutral-400" />
                    {strings.add.photosHint}
                    <input
                      id="photo-input"
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={(e) => {
                        void onPhotoPick(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {photoError && <p className="text-xs text-red-600" role="alert">{photoError}</p>}
                  {photos.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {photos.map((photo, i) => (
                        <div key={i} className="relative">
                          <img
                            src={photo.dataUrl}
                            alt={photo.name}
                            className="h-20 w-20 rounded-md border border-neutral-200 object-cover"
                          />
                          <button
                            type="button"
                            aria-label={`Remove ${photo.name}`}
                            onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white"
                          >
                            <X aria-hidden="true" className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                // Photos require an account (abuse prevention — CONTRACTS amendments);
                // the place itself can still be submitted as a guest.
                <p className="rounded-md bg-neutral-100 p-3 text-sm text-neutral-600">
                  {strings.add.photosRequireAccount}{' '}
                  <Link to="/login" className="font-medium text-blue-600 hover:underline">
                    {strings.auth.signIn}
                  </Link>
                </p>
              )}
              <button
                type="button"
                onClick={() => setStep(5)}
                className="text-sm text-neutral-500 underline hover:text-neutral-700"
              >
                {strings.add.skip}
              </button>
            </div>
          )}

          {/* ---------- step 5: review ---------- */}
          {step === 5 && (
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h1 className="text-sm font-semibold text-neutral-900">{strings.add.step5Title}</h1>
              <div className="overflow-hidden rounded-lg border border-neutral-200">
                <MiniMap lat={coords.lat} lng={coords.lng} className="h-32 w-full" pinColor={pinColor} />
                <div className="space-y-2 p-3">
                  <p className="text-sm font-medium text-neutral-900">{name.trim()}</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedCategories.map((c) => (
                      <span
                        key={c.slug}
                        className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
                      >
                        <CategoryDot color={c.color} />
                        <span aria-hidden="true">{c.icon}</span>
                        {c.name}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-neutral-500">
                    {Object.keys(attrs).length} attributes · {photos.length}{' '}
                    {photos.length === 1 ? 'photo' : 'photos'}
                  </p>
                </div>
              </div>
              {!user && (
                <p className="rounded-md bg-neutral-100 p-2 text-xs text-neutral-600">
                  You're submitting as a guest — submissions are community-moderated.
                </p>
              )}
              {/* honeypot — hidden from humans, bots fill it */}
              <input
                ref={websiteRef}
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="absolute left-[-9999px] h-0 w-0 opacity-0"
              />
            </div>
          )}

          {/* footer buttons */}
          {step >= 2 && (
            <div className="border-t border-neutral-200 p-4">
              {step < 5 ? (
                <Button className="w-full" disabled={!stepValid} onClick={() => setStep((s) => s + 1)}>
                  {strings.add.continue}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={submitting}
                  onClick={() => {
                    setSubmitError(null);
                    void submit(false);
                  }}
                >
                  {submitting && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
                  {submitting ? strings.add.submitting : strings.add.submit}
                </Button>
              )}
            </div>
          )}
        </div>
      </main>

      <div className="hidden md:block">
        <Footer />
      </div>

      {/* duplicate warning */}
      <Dialog open={duplicates !== null} onOpenChange={(open) => !open && setDuplicates(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⚠️ {strings.add.duplicateTitle}</DialogTitle>
            <DialogDescription>
              These places are very close to your pin. Help us keep the map free of duplicates.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[40vh] space-y-2 overflow-y-auto">
            {(duplicates ?? []).map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    <span aria-hidden="true" className="mr-1">{d.categories[0]?.icon ?? '📍'}</span>
                    {d.name}
                  </p>
                  <div className="flex items-center gap-2">
                    {typeof d.distance_km === 'number' && (
                      <span className="text-xs text-neutral-500">
                        {formatDistance(d.distance_km)} away
                      </span>
                    )}
                    <VerifiedLine lastVerifiedAt={d.last_verified_at} confirmCount={d.confirm_count} />
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/place/${d.slug}`} target="_blank">
                      {strings.add.duplicateView}
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      toast.info(strings.add.duplicateToast);
                      navigate(`/place/${d.slug}`);
                    }}
                  >
                    {strings.add.duplicateThisIsIt}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDuplicates(null);
                if (step === 1) {
                  setStep(2);
                } else {
                  void submit(true);
                }
              }}
            >
              {strings.add.duplicateNone}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
