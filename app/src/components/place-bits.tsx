// Shared small components: category dot, category chips on cards, verified line.
import type { CategoryRef } from '@/lib/api-types';
import { verifiedLine } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CategoryDot({ color, className }: { color?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)}
      style={{ background: color ?? '#475569' }}
    />
  );
}

/** Compact category chip used on place cards: dot + emoji + name. */
export function PlaceCategoryChip({ category }: { category: CategoryRef }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
      <CategoryDot color={category.color} />
      <span aria-hidden="true">{category.icon}</span>
      <span>{category.name}</span>
    </span>
  );
}

export function CategoryChipsRow({
  categories,
  max,
}: {
  categories: CategoryRef[];
  max?: number;
}) {
  const shown = max ? categories.slice(0, max) : categories;
  const extra = max ? categories.length - shown.length : 0;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((c) => (
        <PlaceCategoryChip key={c.slug} category={c} />
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
          +{extra}
        </span>
      )}
    </span>
  );
}

/** "✓ Verified N days ago" line with semantic color. */
export function VerifiedLine({
  lastVerifiedAt,
  confirmCount,
  className,
}: {
  lastVerifiedAt: string | null | undefined;
  confirmCount?: number;
  className?: string;
}) {
  const line = verifiedLine(lastVerifiedAt);
  return (
    <span
      className={cn(
        'text-xs',
        line.tone === 'success' && 'text-emerald-600',
        line.tone === 'warning' && 'text-amber-600',
        line.tone === 'muted' && 'text-neutral-400',
        className,
      )}
    >
      {line.text}
      {typeof confirmCount === 'number' && confirmCount > 0 && line.tone !== 'muted'
        ? ` · ${confirmCount} ✓`
        : ''}
    </span>
  );
}
