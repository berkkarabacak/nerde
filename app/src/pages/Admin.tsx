// Admin — /admin (role=admin only). Functional over pretty (DESIGN_SYSTEM §6.7).
// Tabs: Reports, Places, Categories, Stats.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import EmptyState from '@/components/EmptyState';
import AdminFunnel from '@/components/AdminFunnel';
import Footer from '@/components/Footer';
import Header from '@/components/Header';
import OfflineBanner from '@/components/OfflineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCategories } from '@/lib/categories';
import { isDemo } from '@/lib/demo';
import { shortDate } from '@/lib/format';
import { setMeta } from '@/lib/seo';
import { strings } from '@/lib/strings';
import type { Category, CategoryAttribute, PlaceSummary } from '@/lib/api-types';

// ---- admin API shapes (not part of the pinned public types) ----
interface AdminReport {
  id: number;
  place_id: number;
  place_name?: string;
  place_slug?: string;
  reason: string;
  note: string;
  reporter?: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
}

interface AdminPlace {
  id: number;
  slug: string;
  name: string;
  description: string;
  status: 'published' | 'pending' | 'removed';
  source: string;
  categories: { slug: string; name: string; icon: string; color: string }[];
  created_at: string;
}

interface AdminStats {
  places?: number;
  users?: number;
  open_reports?: number;
  pending_places?: number;
  comments?: number;
  photos?: number;
  top_events?: { type: string; count: number }[];
  [key: string]: unknown;
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiRequestError(res.status, data as { error: string });
  return data as T;
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const { categories, retry: reloadCategories } = useCategories();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [reportStatus, setReportStatus] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const [places, setPlaces] = useState<AdminPlace[] | null>(null);
  const [placeQuery, setPlaceQuery] = useState('');
  const [editPlace, setEditPlace] = useState<AdminPlace | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    setMeta({ title: 'Admin — Nerde', robots: 'noindex,nofollow', canonical: '/admin', jsonLd: null });
  }, []);

  const loadStats = useCallback(() => {
    adminFetch<AdminStats>('/api/admin/stats')
      .then(setStats)
      .catch(() => setStats({}));
  }, []);

  const loadReports = useCallback((status: string) => {
    setReports(null);
    adminFetch<{ reports: AdminReport[] }>(`/api/admin/reports?status=${status}`)
      .then((res) => setReports(res.reports))
      .catch(() => setReports([]));
  }, []);

  const loadPlaces = useCallback((q: string) => {
    setPlaces(null);
    // Preferred: dedicated admin list (all statuses). Fallback: public bbox
    // search (published only) since CONTRACTS §6 doesn't pin an admin list
    // endpoint — keeps the table functional either way.
    adminFetch<{ places: AdminPlace[] }>(`/api/admin/places?q=${encodeURIComponent(q)}`)
      .then((res) => setPlaces(res.places))
      .catch(() => {
        const p = new URLSearchParams({ bbox: '-180,-85,180,85', limit: '200' });
        if (q) p.set('q', q);
        fetch(`/api/places?${p.toString()}`, { credentials: 'include' })
          .then((res) => (res.ok ? res.json() : { places: [] }))
          .then((data: { places: PlaceSummary[] }) => {
            setPlaces(
              data.places.map((pl) => ({
                id: pl.id,
                slug: pl.slug,
                name: pl.name,
                description: '',
                status: 'published' as const,
                source: '—',
                categories: pl.categories,
                created_at: '',
              })),
            );
          })
          .catch(() => setPlaces([]));
      });
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadStats();
    loadReports('open');
    loadPlaces('');
  }, [isAdmin, loadStats, loadReports, loadPlaces]);

  const act = async (fn: () => Promise<unknown>, done?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      done?.();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : strings.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  // Demo build: no accounts, no admin backend on static hosting.
  if (isDemo) {
    return (
      <div className="flex min-h-screen flex-col">
        <OfflineBanner />
        <Header />
        <main className="flex flex-1 items-center justify-center">
          <EmptyState
            emoji="🔒"
            title="Admin is disabled in this demo build"
            body="This preview is read-only — moderation tools only work on the live site."
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

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col">
        <OfflineBanner />
        <Header />
        <main className="flex flex-1 items-center justify-center">
          <EmptyState
            emoji="🔒"
            title="Admins only."
            body={user ? 'This account has no admin access.' : 'Log in with an admin account.'}
            action={
              <Button asChild>
                <Link to={user ? '/' : '/login?next=%2Fadmin'}>{user ? strings.errors.backToMap : 'Log in'}</Link>
              </Button>
            }
          />
        </main>
        <Footer />
      </div>
    );
  }

  const statCards: { label: string; value: unknown }[] = [
    { label: 'Places', value: stats?.places },
    { label: 'Users', value: stats?.users },
    { label: 'Open reports', value: stats?.open_reports },
    { label: 'Pending places', value: stats?.pending_places },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <OfflineBanner />
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4">
        <h1 className="text-xl font-semibold text-neutral-900">Admin</h1>

        <Tabs defaultValue="reports" className="mt-4">
          <TabsList>
            <TabsTrigger value="reports">
              Reports
              {typeof stats?.open_reports === 'number' && stats.open_reports > 0 && (
                <Badge className="ml-1.5 bg-red-600 text-white">{stats.open_reports}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="places">Places</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
            {/* Funnel tab renders only for role=admin: the page-level gate above
                early-returns for everyone else before Tabs ever mounts. */}
            <TabsTrigger value="funnel">{strings.admin.funnel.tab}</TabsTrigger>
          </TabsList>

          {/* ---------- Reports ---------- */}
          <TabsContent value="reports" className="mt-4 space-y-3">
            <div className="flex gap-2">
              {(['open', 'resolved', 'dismissed'] as const).map((s) => (
                <Button
                  key={s}
                  variant={reportStatus === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setReportStatus(s);
                    loadReports(s);
                  }}
                >
                  {s}
                </Button>
              ))}
            </div>
            {reports === null ? (
              <p className="text-sm text-neutral-500">Loading…</p>
            ) : reports.length === 0 ? (
              <p className="text-sm text-neutral-500">No {reportStatus} reports.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Place</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Reporter</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        {r.place_slug ? (
                          <Link to={`/place/${r.place_slug}`} className="text-blue-600 hover:underline">
                            {r.place_name ?? `#${r.place_id}`}
                          </Link>
                        ) : (
                          `#${r.place_id}`
                        )}
                      </TableCell>
                      <TableCell>{r.reason}</TableCell>
                      <TableCell className="max-w-48 truncate">{r.note}</TableCell>
                      <TableCell>{r.reporter ?? 'guest'}</TableCell>
                      <TableCell>{shortDate(r.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {r.status === 'open' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    () =>
                                      adminFetch(`/api/admin/reports/${r.id}`, {
                                        method: 'POST',
                                        body: JSON.stringify({ status: 'resolved' }),
                                      }),
                                    () => {
                                      loadReports(reportStatus);
                                      loadStats();
                                    },
                                  )
                                }
                              >
                                Resolve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    () =>
                                      adminFetch(`/api/admin/reports/${r.id}`, {
                                        method: 'POST',
                                        body: JSON.stringify({ status: 'dismissed' }),
                                      }),
                                    () => loadReports(reportStatus),
                                  )
                                }
                              >
                                Dismiss
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                () =>
                                  adminFetch(`/api/admin/places/${r.place_id}`, {
                                    method: 'POST',
                                    body: JSON.stringify({ action: 'remove' }),
                                  }),
                                () => {
                                  loadReports(reportStatus);
                                  loadStats();
                                },
                              )
                            }
                          >
                            Remove place
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ---------- Places ---------- */}
          <TabsContent value="places" className="mt-4 space-y-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                loadPlaces(placeQuery);
              }}
            >
              <Input
                value={placeQuery}
                onChange={(e) => setPlaceQuery(e.target.value)}
                placeholder="Search places…"
                className="max-w-xs"
                aria-label="Search places"
              />
              <Button type="submit" variant="outline" size="sm" className="h-9">
                Search
              </Button>
            </form>
            {places === null ? (
              <p className="text-sm text-neutral-500">Loading…</p>
            ) : places.length === 0 ? (
              <p className="text-sm text-neutral-500">No places found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Categories</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {places.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link to={`/place/${p.slug}`} className="text-blue-600 hover:underline">
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-40 truncate">
                        {p.categories.map((c) => `${c.icon} ${c.name}`).join(', ')}
                      </TableCell>
                      <TableCell>{p.source}</TableCell>
                      <TableCell>
                        <Badge
                          variant={p.status === 'published' ? 'default' : 'secondary'}
                          className={p.status === 'removed' ? 'bg-red-100 text-red-700' : ''}
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{shortDate(p.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditPlace(p);
                              setEditName(p.name);
                              setEditDesc(p.description);
                            }}
                          >
                            Edit
                          </Button>
                          {p.status !== 'published' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void act(
                                  () =>
                                    adminFetch(`/api/admin/places/${p.id}`, {
                                      method: 'POST',
                                      body: JSON.stringify({ action: 'publish' }),
                                    }),
                                  () => loadPlaces(placeQuery),
                                )
                              }
                            >
                              Publish
                            </Button>
                          )}
                          {p.status !== 'removed' ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              onClick={() =>
                                void act(
                                  () =>
                                    adminFetch(`/api/admin/places/${p.id}`, {
                                      method: 'POST',
                                      body: JSON.stringify({ action: 'remove' }),
                                    }),
                                  () => {
                                    loadPlaces(placeQuery);
                                    loadStats();
                                  },
                                )
                              }
                            >
                              Remove
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void act(
                                  () =>
                                    adminFetch(`/api/admin/places/${p.id}`, {
                                      method: 'POST',
                                      body: JSON.stringify({ action: 'restore' }),
                                    }),
                                  () => loadPlaces(placeQuery),
                                )
                              }
                            >
                              Restore
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ---------- Categories ---------- */}
          <TabsContent value="categories" className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Icon</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Attributes</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell aria-hidden="true">{c.icon}</TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="font-mono text-xs">{c.slug}</TableCell>
                    <TableCell>{c.grp}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 rounded-full"
                          style={{ background: c.color }}
                        />
                        <span className="font-mono text-xs">{c.color}</span>
                      </span>
                    </TableCell>
                    <TableCell>{c.attributes.length}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setEditCategory(c)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          {/* ---------- Stats ---------- */}
          <TabsContent value="stats" className="mt-4 space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {statCards.map((card) => (
                <div key={card.label} className="rounded-lg border border-neutral-200 bg-white p-4">
                  <p className="text-xs text-neutral-500">{card.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-neutral-900">
                    {typeof card.value === 'number' ? card.value : '—'}
                  </p>
                </div>
              ))}
            </div>
            {Array.isArray(stats?.top_events) && stats.top_events.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">Top events (last 30 days)</h2>
                <Table className="mt-2 max-w-md">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.top_events.map((e) => (
                      <TableRow key={e.type}>
                        <TableCell className="font-mono text-xs">{e.type}</TableCell>
                        <TableCell>{e.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ---------- Funnel ---------- */}
          <TabsContent value="funnel" className="mt-4">
            <AdminFunnel />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />

      {/* edit place dialog */}
      <Dialog open={editPlace !== null} onOpenChange={(open) => !open && setEditPlace(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit place</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-place-name">Name</Label>
              <Input id="edit-place-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-place-desc">Description</Label>
              <Textarea id="edit-place-desc" rows={4} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={busy || editName.trim().length < 2}
              onClick={() =>
                void act(
                  () =>
                    adminFetch(`/api/admin/places/${editPlace?.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() }),
                    }),
                  () => {
                    setEditPlace(null);
                    loadPlaces(placeQuery);
                    toast.success('Place updated');
                  },
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* edit category dialog */}
      <CategoryEditDialog
        category={editCategory}
        onClose={() => setEditCategory(null)}
        onSaved={() => {
          setEditCategory(null);
          reloadCategories();
          toast.success('Category updated');
        }}
      />
    </div>
  );
}

// ---- category editor: labels + attribute definitions ----
function CategoryEditDialog({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [grp, setGrp] = useState<'fitness' | 'outdoor'>('outdoor');
  const [sort, setSort] = useState(0);
  const [attrs, setAttrs] = useState<CategoryAttribute[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!category) return;
    setName(category.name);
    setIcon(category.icon);
    setColor(category.color);
    setGrp(category.grp);
    setSort(category.sort);
    setAttrs(category.attributes.map((a) => ({ ...a })));
  }, [category]);

  const updateAttr = (index: number, patch: Partial<CategoryAttribute>) => {
    setAttrs((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const save = async () => {
    if (!category || busy) return;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/categories/${category.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          icon,
          color,
          grp,
          sort,
          attributes: attrs.map((a) => ({
            key: a.key,
            label: a.label,
            type: a.type,
            options: a.type === 'enum' ? (a.options ?? []) : null,
            filterable: a.filterable,
            sort: a.sort,
          })),
        }),
      });
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : strings.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={category !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit category — {category?.slug}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-icon">Icon (emoji)</Label>
            <Input id="cat-icon" value={icon} onChange={(e) => setIcon(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-color">Color</Label>
            <Input id="cat-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-20 p-1" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-grp">Group</Label>
            <Select value={grp} onValueChange={(v) => setGrp(v as 'fitness' | 'outdoor')}>
              <SelectTrigger id="cat-grp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fitness">fitness</SelectItem>
                <SelectItem value="outdoor">outdoor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-sort">Sort</Label>
            <Input
              id="cat-sort"
              type="number"
              value={String(sort)}
              onChange={(e) => setSort(Number.parseInt(e.target.value, 10) || 0)}
            />
          </div>
        </div>

        <h3 className="mt-4 text-sm font-semibold text-neutral-900">Attributes</h3>
        <div className="space-y-3">
          {attrs.map((attr, i) => (
            <div key={attr.key} className="grid items-end gap-2 rounded-md border border-neutral-200 p-2 sm:grid-cols-6">
              <div className="space-y-1">
                <Label className="text-xs">Key</Label>
                <Input value={attr.key} disabled className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Label</Label>
                <Input value={attr.label} onChange={(e) => updateAttr(i, { label: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Input value={attr.type} disabled className="text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Options (CSV, enum)</Label>
                <Input
                  value={(attr.options ?? []).join(',')}
                  disabled={attr.type !== 'enum'}
                  onChange={(e) =>
                    updateAttr(i, {
                      options: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sort</Label>
                <Input
                  type="number"
                  value={String(attr.sort)}
                  onChange={(e) => updateAttr(i, { sort: Number.parseInt(e.target.value, 10) || 0 })}
                />
              </div>
              <div className="flex min-h-[36px] items-center gap-1.5">
                <Checkbox
                  id={`attr-filterable-${i}`}
                  checked={attr.filterable}
                  onCheckedChange={(v) => updateAttr(i, { filterable: v === true })}
                />
                <Label htmlFor={`attr-filterable-${i}`} className="text-xs font-normal">
                  Filterable
                </Label>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={() => void save()} disabled={busy || name.trim().length < 2}>
            {busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
            Save category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
