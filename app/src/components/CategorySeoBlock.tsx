// CategorySeoBlock — the crawlable HTML block for /c/:slug (SEO_STRATEGY §5):
// H1 + live count, intro, most-verified links, attribute explainer, FAQ.
// Counts come from the bbox response's total_count (contract amendment,
// CRITICAL_REVIEW I1) so "N places worldwide" is exact, not the 1000-cap.
// "Top cities" remains omitted for now (PlaceSummary gained city/country_code
// in amendment A9; a top-cities block is a separate SEO decision).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { attrExplainer, CATEGORY_CONTENT } from '@/lib/category-content';
import type { Category, PlaceSummary } from '@/lib/api-types';

export interface CategorySeoData {
  total: number;
  capped: boolean;
  topPlaces: PlaceSummary[];
}

export default function CategorySeoBlock({
  category,
  onSeoData,
}: {
  category: Category;
  onSeoData?: (data: CategorySeoData) => void;
}) {
  const [result, setResult] = useState<{ places: PlaceSummary[]; total: number; truncated: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .places({ bbox: '-180,-85,180,85', cat: category.slug, limit: 1000 })
      .then((res) => {
        if (!cancelled) setResult({ places: res.places, total: res.total_count, truncated: res.truncated });
      })
      .catch(() => {
        if (!cancelled) setResult({ places: [], total: 0, truncated: false });
      });
    return () => {
      cancelled = true;
    };
  }, [category.slug]);

  const seoData = useMemo<CategorySeoData | null>(() => {
    if (!result) return null;
    const topPlaces = result.places
      .slice()
      .sort((a, b) => b.confirm_count - a.confirm_count)
      .slice(0, 50);
    // total_count is the exact category count; capped marks that topPlaces is
    // drawn from a sample (relevant only when total > 1000).
    return { total: result.total, capped: result.truncated, topPlaces };
  }, [result]);

  useEffect(() => {
    if (seoData) onSeoData?.(seoData);
  }, [seoData, onSeoData]);

  const content = CATEGORY_CONTENT[category.slug];
  const filterable = category.attributes
    .filter((a) => a.filterable)
    .sort((a, b) => a.sort - b.sort);

  return (
    <section className="border-t border-neutral-200 bg-white px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">
            <span aria-hidden="true" className="mr-2">{category.icon}</span>
            {category.name}
            {seoData && (
              <span className="ml-2 text-base font-normal text-neutral-500">
                — {seoData.total} places mapped worldwide
              </span>
            )}
          </h1>
          {content && <p className="mt-3 text-sm leading-6 text-neutral-600">{content.intro}</p>}
        </div>

        {seoData && seoData.topPlaces.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Most verified places</h2>
            <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {seoData.topPlaces.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/place/${p.slug}`}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {p.name}
                  </Link>
                  {p.confirm_count > 0 && (
                    <span className="ml-1.5 text-xs text-neutral-400">
                      ✓ {p.confirm_count}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {filterable.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">What you can filter by</h2>
            <dl className="mt-2 space-y-1">
              {filterable.map((attr) => {
                const explainer = attrExplainer(category.slug, attr.key);
                return (
                  <div key={attr.key} className="text-sm text-neutral-600">
                    <dt className="inline font-medium text-neutral-900">{attr.label}</dt>
                    {explainer && <dd className="inline"> — {explainer}</dd>}
                  </div>
                );
              })}
            </dl>
          </div>
        )}

        {content && content.faq.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">FAQ</h2>
            <div className="mt-2 space-y-4">
              {content.faq.map((item) => (
                <div key={item.q}>
                  <h3 className="text-sm font-medium text-neutral-900">{item.q}</h3>
                  <p className="mt-1 text-sm text-neutral-600">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
