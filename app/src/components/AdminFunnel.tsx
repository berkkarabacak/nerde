// AdminFunnel — the /admin "Funnel" tab (P1 analytics view; MASTER_PROMPT §25/§26,
// PRODUCT_SPEC §7). Reads GET /api/admin/funnel?days=N — the endpoint contract is
// pinned with the backend agent and lands in parallel; a 404/error must render the
// error state, never crash the page. Bars are plain CSS widths (no chart lib,
// DESIGN_SYSTEM §7 "do not add: Charts"). All copy via strings.ts.
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiRequestError } from '@/lib/api';
import { strings } from '@/lib/strings';

// ---- funnel endpoint contract (GET /api/admin/funnel?days=7|30) ----
// {days, totals: {<event_type>: count}, unique_clients, by_day: [{date, type, count}]}
// totals may omit event types with zero events; by_day rows are sparse (only
// date/type pairs that occurred). Defensive reads below assume both.
interface FunnelResponse {
  days: number;
  totals: Record<string, number>;
  unique_clients: number;
  by_day: { date: string; type: string; count: number }[];
}

const s = strings.admin.funnel;

// The ordered §26 funnel; everything else lands in the "other events" grid.
const FUNNEL_STEPS = [
  'search_performed',
  'place_viewed',
  'place_saved',
  'add_place_started',
  'place_submitted',
  'place_verified',
] as const;

const OTHER_EVENTS = [
  'category_selected',
  'filter_applied',
  'near_me_used',
  'place_reported',
] as const;

const TREND_ROWS = 14;

type StepLabelKey = keyof typeof s.stepLabels;

async function fetchFunnel(days: number): Promise<FunnelResponse> {
  const res = await fetch(`/api/admin/funnel?days=${days}`, { credentials: 'include' });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiRequestError(res.status, data as { error: string });
  return data as FunnelResponse;
}

function stepLabel(key: string): string {
  return key in s.stepLabels ? s.stepLabels[key as StepLabelKey] : key;
}

export default function AdminFunnel() {
  const [days, setDays] = useState<7 | 30>(30);
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // load() itself never sets state synchronously so the effect below stays
  // clean (react-hooks/set-state-in-effect); callers entering a fetch set
  // loading=true from their event handler instead.
  const load = useCallback((rangeDays: number) => {
    fetchFunnel(rangeDays)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setData(null);
        setError(err instanceof ApiRequestError ? err.message : strings.errors.generic);
        setLoading(false);
      });
  }, []);

  // Initial fetch + refetch on range change (initial useState covers mount).
  useEffect(() => {
    load(days);
  }, [days, load]);

  const selectRange = (d: 7 | 30) => {
    if (d === days) return;
    setLoading(true);
    setError(null);
    setDays(d);
  };

  const retry = () => {
    setLoading(true);
    setError(null);
    load(days);
  };

  const totals = data?.totals ?? {};
  const totalEvents = Object.values(totals).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const isEmpty = data !== null && totalEvents === 0 && (data.unique_clients ?? 0) === 0;

  // Funnel step counts + step-to-step conversion (previous step = 0 → no % shown).
  const steps = FUNNEL_STEPS.map((type, i) => {
    const count = totals[type] ?? 0;
    const prev = i > 0 ? (totals[FUNNEL_STEPS[i - 1]] ?? 0) : null;
    const conversion = prev !== null && prev > 0 ? (count / prev) * 100 : null;
    return { type, count, conversion };
  });
  const maxCount = Math.max(1, ...steps.map((step) => step.count));

  // Contribution-health trend: pivot sparse by_day rows into date → submitted/verified.
  const trendDates: string[] = [];
  const trendByDate = new Map<string, { submitted: number; verified: number }>();
  for (const row of data?.by_day ?? []) {
    if (row.type !== 'place_submitted' && row.type !== 'place_verified') continue;
    let entry = trendByDate.get(row.date);
    if (!entry) {
      entry = { submitted: 0, verified: 0 };
      trendByDate.set(row.date, entry);
      trendDates.push(row.date);
    }
    if (row.type === 'place_submitted') entry.submitted += row.count;
    else entry.verified += row.count;
  }
  trendDates.sort();
  const trend = trendDates.slice(-TREND_ROWS);

  return (
    <div className="space-y-6">
      <div className="flex gap-2" role="group" aria-label="Date range">
        {([7, 30] as const).map((d) => (
          <Button
            key={d}
            variant={days === d ? 'default' : 'outline'}
            size="sm"
            onClick={() => selectRange(d)}
          >
            {d === 7 ? s.range7 : s.range30}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          {s.loading}
        </p>
      ) : error !== null ? (
        <EmptyState
          emoji="⚠️"
          title={s.errorTitle}
          body={`${s.errorBody} (${error})`}
          action={
            <Button variant="outline" size="sm" onClick={retry}>
              {strings.errors.retry}
            </Button>
          }
        />
      ) : isEmpty ? (
        <EmptyState emoji="📊" title={s.emptyTitle} body={s.emptyBody} />
      ) : (
        <>
          {/* unique visitors */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
              <p className="text-xs text-neutral-500">{s.uniqueVisitors}</p>
              <p className="mt-1 text-2xl font-semibold text-neutral-900">
                {data?.unique_clients ?? 0}
              </p>
              <p className="mt-1 text-xs text-neutral-400">{s.uniqueVisitorsHint}</p>
            </div>
          </div>

          {/* ordered funnel — CSS-width bars with step-to-step conversion */}
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">{s.funnelTitle}</h2>
            <div className="mt-2 space-y-2">
              {steps.map((step) => (
                <div key={step.type} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-xs text-neutral-600">
                    {stepLabel(step.type)}
                  </span>
                  <div className="h-6 min-w-0 flex-1 rounded bg-neutral-100">
                    <div
                      className="h-6 rounded bg-blue-600"
                      style={{ width: `${Math.max(0, Math.min(100, (step.count / maxCount) * 100))}%` }}
                      role="img"
                      aria-label={`${stepLabel(step.type)}: ${step.count}`}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-sm font-medium text-neutral-900 tabular-nums">
                    {step.count}
                  </span>
                  <span className="hidden w-36 shrink-0 text-right text-xs text-neutral-500 sm:inline">
                    {step.conversion !== null
                      ? s.conversionFromPrevious(step.conversion.toFixed(1))
                      : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* remaining event counts */}
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">{s.otherEventsTitle}</h2>
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
              {OTHER_EVENTS.map((type) => (
                <div key={type} className="rounded-lg border border-neutral-200 bg-white p-4">
                  <p className="text-xs text-neutral-500">{stepLabel(type)}</p>
                  <p className="mt-1 text-2xl font-semibold text-neutral-900">
                    {totals[type] ?? 0}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* contribution health: submissions + verifications over recent days */}
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              {s.trendTitle(Math.min(TREND_ROWS, data?.days ?? days))}
            </h2>
            {trend.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">{s.trendEmpty}</p>
            ) : (
              <Table className="mt-2 max-w-md">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>{s.trendSubmitted}</TableHead>
                    <TableHead>{s.trendVerified}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trend.map((date) => {
                    const entry = trendByDate.get(date) ?? { submitted: 0, verified: 0 };
                    return (
                      <TableRow key={date}>
                        <TableCell className="font-mono text-xs">{date}</TableCell>
                        <TableCell>{entry.submitted}</TableCell>
                        <TableCell>{entry.verified}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
