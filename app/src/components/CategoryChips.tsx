// Category chips rail — horizontal scroll, "All" + 18 categories; desktop gets
// a group dropdown (fitness / outdoor). Selecting fires `category_selected`.
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CategoryDot } from '@/components/place-bits';
import { track } from '@/lib/events';
import { useCategories } from '@/lib/categories';
import { cn } from '@/lib/utils';

export default function CategoryChips({
  activeSlug,
  variant = 'rail',
}: {
  activeSlug?: string;
  /** rail = desktop top rail; pills = mobile floating white pills */
  variant?: 'rail' | 'pills';
}) {
  const navigate = useNavigate();
  const { categories } = useCategories();

  const select = (slug: string | null) => {
    if (slug) {
      track('category_selected', { cat: slug });
      navigate(`/c/${slug}`);
    } else {
      navigate('/');
    }
  };

  const chipCls = (active: boolean) =>
    cn(
      'inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
      variant === 'pills' && 'shadow-md',
      active
        ? 'border-neutral-900 bg-neutral-900 text-white'
        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
    );

  const fitness = categories.filter((c) => c.grp === 'fitness');
  const outdoor = categories.filter((c) => c.grp === 'outdoor');

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="listbox"
        aria-label="Categories"
      >
        <button
          type="button"
          role="option"
          aria-selected={!activeSlug}
          aria-pressed={!activeSlug}
          className={chipCls(!activeSlug)}
          onClick={() => select(null)}
        >
          All
        </button>
        {categories.map((c) => {
          const active = c.slug === activeSlug;
          return (
            <button
              key={c.slug}
              type="button"
              role="option"
              aria-selected={active}
              aria-pressed={active}
              className={chipCls(active)}
              onClick={() => select(active ? null : c.slug)}
            >
              {active && <CategoryDot color={c.color} />}
              <span aria-hidden="true">{c.icon}</span>
              <span>{c.name}</span>
              <span
                aria-label={`${c.place_count} places`}
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums',
                  active ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-500',
                )}
              >
                {c.place_count}
              </span>
            </button>
          );
        })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="hidden shrink-0 md:inline-flex"
            aria-label="Browse categories by group"
          >
            Groups <ChevronDown aria-hidden="true" className="ml-1 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {[
            { label: 'Fitness', items: fitness },
            { label: 'Outdoor', items: outdoor },
          ].map((group) => (
            <DropdownMenuGroup key={group.label}>
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.items.map((c) => (
                <DropdownMenuItem key={c.slug} onSelect={() => select(c.slug)}>
                  <span aria-hidden="true" className="mr-2">{c.icon}</span>
                  {c.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
