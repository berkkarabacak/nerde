// PlaceDetail — /place/:slug. Full place page: photos, attributes, verification,
// save, comments, report, share, external maps link, Place JSON-LD.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Flag,
  Heart,
  Loader2,
  Share2,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import DemoBanner from '@/components/DemoBanner';
import EmptyState from '@/components/EmptyState';
import Footer from '@/components/Footer';
import Header from '@/components/Header';
import MiniMap from '@/components/MiniMap';
import OfflineBanner from '@/components/OfflineBanner';
import { PlaceCategoryChip, VerifiedLine } from '@/components/place-bits';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { track } from '@/lib/events';
import { relativeTime, shortDate, verifiedLine } from '@/lib/format';
import { setMeta } from '@/lib/seo';
import { strings } from '@/lib/strings';
import type { PlaceDetail as PlaceDetailType } from '@/lib/api-types';

export default function PlaceDetail() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [place, setPlace] = useState<PlaceDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('wrong-location');
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.place(slug);
      const canonical = res.canonical_slug ?? res.place.slug;
      if (canonical && canonical !== slug) {
        navigate(`/place/${canonical}`, { replace: true });
        return;
      }
      setPlace(res.place);
      setSaved(res.place.saved_by_me);
      setNotFound(false);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 404 || err.status === 410)) {
        setNotFound(true);
      } else {
        toast.error(strings.errors.generic);
      }
    } finally {
      setLoading(false);
    }
  }, [slug, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (place) track('place_viewed', { place_id: place.id, cat: place.categories[0]?.slug });
  }, [place?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- SEO metadata + Place JSON-LD (SEO_STRATEGY §3.3, §4) ----
  useEffect(() => {
    if (notFound) {
      setMeta({
        title: 'Place not found — Nerde',
        robots: 'noindex,follow',
        canonical: `/place/${slug}`,
        jsonLd: null,
      });
      return;
    }
    if (!place) return;

    const location = place.city || place.country;
    const title = location ? `${place.name}, ${location} — Nerde` : `${place.name} — Nerde`;

    const catNames = place.categories.map((c) => c.name).join(', ');
    const where = [place.city, place.country].filter(Boolean).join(', ');
    const line = verifiedLine(place.last_verified_at);
    const parts = [
      `${place.name} — ${catNames}${where ? ` in ${where}` : ''}.`,
      place.description ? `${place.description.slice(0, 70)}` : '',
      place.last_verified_at
        ? `${line.text.replace('✓ ', '')} · ${strings.place.confirmations(place.confirm_count)}.`
        : '',
    ].filter(Boolean);
    const description = parts.join(' ');

    const hasAttr = (key: string) =>
      place.attrs_resolved.some((a) => a.key === key && a.value === true);

    const jsonLd: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Place',
      name: place.name,
      url: `https://nerde.com/place/${place.slug}`,
      geo: { '@type': 'GeoCoordinates', latitude: place.lat, longitude: place.lng },
      address: {
        '@type': 'PostalAddress',
        ...(place.address ? { streetAddress: place.address } : {}),
        ...(place.city ? { addressLocality: place.city } : {}),
        ...(place.region ? { addressRegion: place.region } : {}),
        ...(place.country_code ? { addressCountry: place.country_code } : {}),
      },
      additionalProperty: place.attrs_resolved
        .filter((a) => a.value !== null && a.value !== false)
        .map((a) => ({
          '@type': 'PropertyValue',
          name: a.label,
          value: a.value,
        })),
    };
    if (place.description) jsonLd.description = place.description.slice(0, 300);
    if (place.photos.length > 0) {
      jsonLd.image = place.photos.map((p) =>
        p.url.startsWith('http') ? p.url : `https://nerde.com${p.url}`,
      );
    }
    if (hasAttr('access_24_7')) jsonLd.openingHours = 'Mo-Su 00:00-24:00';
    if (hasAttr('free')) jsonLd.isAccessibleForFree = true;

    setMeta({
      title,
      description,
      canonical: `/place/${place.slug}`,
      jsonLd,
      ogType: 'place',
      ogImage: place.photos[0]?.url ?? null,
    });
  }, [place, notFound, slug]);

  const requireAuth = useCallback(
    (action: string): boolean => {
      if (user) return true;
      toast.error(action);
      navigate(`/login?next=${encodeURIComponent(`/place/${slug}`)}`);
      return false;
    },
    [user, navigate, slug],
  );

  const toggleSave = async () => {
    if (!place || saveBusy) return;
    if (!requireAuth(strings.auth.loginToSave)) return;
    const next = !saved;
    setSaved(next); // optimistic
    setSaveBusy(true);
    try {
      if (next) {
        await api.save(place.id);
        track('place_saved', { place_id: place.id, cat: place.categories[0]?.slug });
        toast.success('Place saved');
      } else {
        await api.unsave(place.id);
      }
    } catch {
      setSaved(!next); // rollback
      toast.error(strings.errors.generic);
    } finally {
      setSaveBusy(false);
    }
  };

  const vote = async (type: 'confirm' | 'issue', note?: string) => {
    if (!place || verifyBusy) return;
    if (!requireAuth(strings.auth.loginToVerify)) return;
    setVerifyBusy(true);
    try {
      await api.verify(place.id, type, note);
      track('place_verified', { place_id: place.id, type, cat: place.categories[0]?.slug });
      toast.success(type === 'confirm' ? strings.verify.confirmed : strings.verify.thanks);
      setIssueOpen(false);
      setIssueNote('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : strings.errors.generic);
    } finally {
      setVerifyBusy(false);
    }
  };

  const submitReport = async () => {
    if (!place || reportBusy) return;
    setReportBusy(true);
    try {
      await api.report(place.id, reportReason, reportNote.trim() || undefined);
      track('place_reported', { place_id: place.id, reason: reportReason });
      toast.success(strings.verify.thanks);
      setReportOpen(false);
      setReportNote('');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : strings.errors.generic);
    } finally {
      setReportBusy(false);
    }
  };

  const submitComment = async () => {
    if (!place || commentBusy) return;
    if (!requireAuth(strings.auth.loginToVerify)) return;
    const body = comment.trim();
    if (body.length < 1 || body.length > 500) return;
    setCommentBusy(true);
    try {
      await api.addComment(place.id, body);
      setComment('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : strings.errors.generic);
    } finally {
      setCommentBusy(false);
    }
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied');
    } catch {
      toast.error(strings.errors.generic);
    }
  };

  const attrsByCategory = useMemo(() => {
    if (!place) return [];
    const groups: { slug: string; icon: string; name: string; attrs: typeof place.attrs_resolved }[] = [];
    for (const cat of place.categories) {
      const attrs = place.attrs_resolved.filter(
        (a) => a.category_slug === cat.slug && a.value !== null,
      );
      if (attrs.length > 0) groups.push({ slug: cat.slug, icon: cat.icon, name: cat.name, attrs });
    }
    return groups;
  }, [place]);

  // ---------- states ----------
  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col">
        <OfflineBanner />
        <Header />
        <main className="flex flex-1 items-center justify-center">
          <EmptyState
            title={strings.errors.placeNotFound}
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

  if (loading || !place) {
    return (
      <div className="flex min-h-screen flex-col">
        <OfflineBanner />
        <Header />
        <Skeleton className="h-48 w-full rounded-none" />
        <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 p-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="flex gap-2">
            <Skeleton className="h-40 w-64" />
            <Skeleton className="h-40 w-64" />
            <Skeleton className="h-40 w-64" />
          </div>
          <Skeleton className="h-24 w-full" />
        </main>
      </div>
    );
  }

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  const whereLine = [place.address, place.city, place.country].filter(Boolean).join(', ');
  const line = verifiedLine(place.last_verified_at);

  const saveButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void toggleSave()}
      disabled={saveBusy}
      aria-pressed={saved}
      aria-label={saved ? strings.place.saved : strings.place.save}
    >
      <Heart
        aria-hidden="true"
        className={`mr-1.5 h-4 w-4 ${saved ? 'fill-red-500 text-red-500' : ''}`}
      />
      {saved ? strings.place.saved : strings.place.save}
    </Button>
  );

  const directionsButton = (
    <Button asChild variant="outline" size="sm">
      <a href={googleMapsUrl} target="_blank" rel="noreferrer">
        <ExternalLink aria-hidden="true" className="mr-1.5 h-4 w-4" />
        {strings.place.directions}
      </a>
    </Button>
  );

  const verifyButtons = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void vote('confirm')}
        disabled={verifyBusy}
        className="hover:border-emerald-600 hover:text-emerald-600"
      >
        {verifyBusy ? (
          <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Check aria-hidden="true" className="mr-1.5 h-4 w-4" />
        )}
        {strings.place.stillThere.replace('✓ ', '')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (requireAuth(strings.auth.loginToVerify)) setIssueOpen(true);
        }}
        disabled={verifyBusy}
        className="hover:border-amber-500 hover:text-amber-600"
      >
        <TriangleAlert aria-hidden="true" className="mr-1.5 h-4 w-4" />
        {strings.place.somethingWrong.replace('⚠ ', '')}
      </Button>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col pb-16 md:pb-0">
      <OfflineBanner />
      <Header />
      <DemoBanner />

      {/* mini map strip */}
      <MiniMap
        lat={place.lat}
        lng={place.lng}
        className="h-36 w-full md:h-48"
        pinColor={place.categories[0]?.color}
        onClick={() => navigate('/')}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 gap-6 p-4 md:flex">
        <div className="min-w-0 flex-1 space-y-6">
          <div className="space-y-2">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-blue-600"
            >
              <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
              {strings.errors.backToMap}
            </Link>
            <div className="flex flex-wrap items-center gap-1.5">
              {place.categories.map((c) => (
                <Link key={c.slug} to={`/c/${c.slug}`}>
                  <PlaceCategoryChip category={c} />
                </Link>
              ))}
            </div>
            <h1 className="text-xl font-semibold text-neutral-900">{place.name}</h1>
            {whereLine && <p className="text-sm text-neutral-600">📍 {whereLine}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <VerifiedLine
                lastVerifiedAt={place.last_verified_at}
                confirmCount={place.confirm_count}
              />
              {place.issue_count > 0 && (
                <span className="text-xs text-amber-600">
                  ⚠ {place.issue_count} {place.issue_count === 1 ? 'issue' : 'issues'} reported
                </span>
              )}
            </div>
            {/* mobile actions */}
            <div className="flex flex-wrap gap-2 md:hidden">
              {saveButton}
              {directionsButton}
              {verifyButtons}
            </div>
          </div>

          {/* photos */}
          {place.photos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {place.photos.map((photo, i) => (
                <img
                  key={photo.url}
                  src={photo.url}
                  alt={`${place.name} photo ${i + 1}`}
                  loading="lazy"
                  className="h-40 w-auto shrink-0 rounded-lg border border-neutral-200 object-cover"
                />
              ))}
            </div>
          )}

          {place.description && (
            <section>
              <h2 className="text-sm font-semibold text-neutral-900">{strings.place.about}</h2>
              <p className="mt-1 whitespace-pre-line text-sm leading-6 text-neutral-600">
                {place.description}
              </p>
            </section>
          )}

          {attrsByCategory.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-neutral-900">{strings.place.details}</h2>
              <div className="mt-2 space-y-3">
                {attrsByCategory.map((group) => (
                  <div key={group.slug}>
                    <p className="text-xs font-medium text-neutral-500">
                      <span aria-hidden="true" className="mr-1">{group.icon}</span>
                      {group.name}
                    </p>
                    <dl className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      {group.attrs.map((attr) => (
                        <div
                          key={`${attr.category_slug}.${attr.key}`}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <dt className="text-neutral-600">{attr.label}</dt>
                          <dd className="text-neutral-900">
                            {attr.type === 'bool' ? (
                              attr.value === true ? (
                                <span className="text-emerald-600">✓</span>
                              ) : (
                                <span className="text-neutral-400">✗</span>
                              )
                            ) : (
                              String(attr.value)
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          )}

          <Separator />

          {/* comments */}
          <section>
            <h2 className="text-sm font-semibold text-neutral-900">
              {strings.place.commentsTitle(place.comments.length)}
            </h2>
            {place.comments.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">{strings.place.commentsEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {place.comments.map((c, i) => (
                  <li key={`${c.username}-${i}`} className="rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-xs text-neutral-500">
                      <span className="font-medium text-neutral-900">@{c.username}</span> ·{' '}
                      {relativeTime(c.created_at)}
                    </p>
                    <p className="mt-1 text-sm text-neutral-700">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-2">
              <Label htmlFor="comment" className="sr-only">
                {strings.place.commentPlaceholder}
              </Label>
              <Textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                placeholder={strings.place.commentPlaceholder}
                rows={3}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">{comment.length}/500</span>
                <Button
                  size="sm"
                  onClick={() => void submitComment()}
                  disabled={commentBusy || comment.trim().length === 0}
                >
                  {commentBusy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
                  Comment
                </Button>
              </div>
            </div>
          </section>
        </div>

        {/* desktop sidebar */}
        <aside className="mt-6 w-full shrink-0 md:mt-0 md:w-[320px]">
          <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm md:sticky md:top-4">
            <div className="flex gap-2">
              {saveButton}
              {directionsButton}
              <Button variant="outline" size="sm" onClick={() => void share()} aria-label="Share">
                <Share2 aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
            <Separator />
            <div className="flex flex-col gap-2">
              {verifyButtons}
            </div>
            <Separator />
            <div className="space-y-1 text-xs text-neutral-500">
              {place.created_by_username && (
                <p>{strings.place.addedBy(place.created_by_username)}</p>
              )}
              <p>
                Source: {place.source === 'osm' ? 'OpenStreetMap' : place.source} ·{' '}
                {shortDate(place.created_at)}
              </p>
              <p className="text-neutral-400">{line.text}</p>
            </div>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-red-600"
            >
              <Flag aria-hidden="true" className="h-3.5 w-3.5" />
              {strings.place.report}
            </button>
          </div>
        </aside>
      </main>

      {/* mobile sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-neutral-200 bg-white md:hidden">
        {saveButton}
        {verifyButtons}
        {directionsButton}
      </div>

      <Footer />

      {/* issue dialog */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{strings.place.somethingWrong}</DialogTitle>
            <DialogDescription>
              Tell the community what's wrong with this place (optional).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
            placeholder="e.g. bars removed, place closed…"
            rows={3}
            aria-label="Issue note"
          />
          <DialogFooter>
            <Button
              onClick={() => void vote('issue', issueNote.trim() || undefined)}
              disabled={verifyBusy}
            >
              {verifyBusy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* report dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{strings.place.report}</DialogTitle>
            <DialogDescription>
              Reports go to the moderation queue. Thanks for keeping the map clean.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="report-reason">Reason</Label>
              <Select value={reportReason} onValueChange={setReportReason}>
                <SelectTrigger id="report-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wrong-location">Wrong location</SelectItem>
                  <SelectItem value="does-not-exist">Place doesn't exist</SelectItem>
                  <SelectItem value="spam">Spam or advertising</SelectItem>
                  <SelectItem value="inappropriate">Inappropriate content</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-note">Note (optional)</Label>
              <Textarea
                id="report-note"
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void submitReport()} disabled={reportBusy}>
              {reportBusy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
