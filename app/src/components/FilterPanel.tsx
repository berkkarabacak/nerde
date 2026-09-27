// FilterPanel — dynamic bool-attribute filters for the active category.
// Desktop: Popover with checkbox rows. Mobile: bottom Sheet. Applying fires
// `filter_applied` and the parent refetches with &attrs=.
import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { CategoryDot } from '@/components/place-bits';
import { track } from '@/lib/events';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Category } from '@/lib/api-types';

interface FilterPanelProps {
  category: Category | undefined;
  activeAttrs: string[]; // entries like "calisthenics.pull_up_bars"
  onChange: (attrs: string[]) => void;
  triggerClassName?: string;
  triggerVariant?: 'button' | 'fab';
}

export default function FilterPanel({
  category,
  activeAttrs,
  onChange,
  triggerClassName,
  triggerVariant = 'button',
}: FilterPanelProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const filterable = (category?.attributes ?? [])
    .filter((a) => a.filterable && a.type === 'bool')
    .sort((a, b) => a.sort - b.sort);

  if (!category) return null;

  const toggle = (key: string, checked: boolean) => {
    const fullKey = `${category.slug}.${key}`;
    const next = checked ? [...activeAttrs, fullKey] : activeAttrs.filter((k) => k !== fullKey);
    track('filter_applied', { cat: category.slug, key: fullKey, on: checked });
    onChange(next);
  };

  const clearAll = () => onChange([]);

  const count = activeAttrs.length;

  const content = (
    <div className="space-y-3 p-1">
      {filterable.length === 0 ? (
        <p className="text-sm text-neutral-500">No filters for this category yet.</p>
      ) : (
        <div className="space-y-2">
          {filterable.map((attr) => {
            const fullKey = `${category.slug}.${attr.key}`;
            const id = `filter-${fullKey}`;
            const checked = activeAttrs.includes(fullKey);
            return (
              <div key={attr.key} className="flex min-h-[44px] items-center gap-2 md:min-h-0">
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(v) => toggle(attr.key, v === true)}
                />
                <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                  {attr.label}
                </Label>
              </div>
            );
          })}
        </div>
      )}
      {count > 0 && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="text-neutral-600">
          Clear all ({count})
        </Button>
      )}
    </div>
  );

  const trigger =
    triggerVariant === 'fab' ? (
      <button
        type="button"
        aria-label={`Filters${count > 0 ? ` (${count} active)` : ''}`}
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          'relative flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2'
        }
      >
        <SlidersHorizontal aria-hidden="true" className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] font-medium text-white">
            {count}
          </span>
        )}
      </button>
    ) : (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={triggerClassName}
        aria-label={`Filters${count > 0 ? ` (${count} active)` : ''}`}
      >
        <SlidersHorizontal aria-hidden="true" className="mr-1.5 h-4 w-4" />
        Filters
        {count > 0 && (
          <span className="ml-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] font-medium text-white">
            {count}
          </span>
        )}
      </Button>
    );

  const activeChips = count > 0 && (
    <div className="flex flex-wrap items-center gap-1.5">
      {activeAttrs.map((fullKey) => {
        const key = fullKey.slice(fullKey.indexOf('.') + 1);
        const attr = filterable.find((a) => a.key === key);
        return (
          <button
            key={fullKey}
            type="button"
            aria-pressed="true"
            aria-label={`Remove filter ${attr?.label ?? key}`}
            onClick={() => toggle(key, false)}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border-2 bg-white px-3 py-1 text-xs text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            style={{ borderColor: category.color }}
          >
            <CategoryDot color={category.color} />
            <span>{attr?.label ?? key}</span>
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
        );
      })}
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex items-center gap-2">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-lg">
            <SheetHeader>
              <SheetTitle>
                <span aria-hidden="true" className="mr-1.5">{category.icon}</span>
                Filters — {category.name}
              </SheetTitle>
            </SheetHeader>
            <div className="max-h-[60vh] overflow-y-auto px-1 pb-6">{content}</div>
          </SheetContent>
        </Sheet>
        {activeChips}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-64 border-neutral-200 shadow-md">
          <p className="mb-2 text-sm font-semibold text-neutral-900">
            Filters — {category.name}
          </p>
          {content}
        </PopoverContent>
      </Popover>
      {activeChips}
    </div>
  );
}
