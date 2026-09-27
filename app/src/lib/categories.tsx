// Categories context — fetched once, shared app-wide (CONTRACTS §4/§6).
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { Category } from './api-types';

interface CategoriesState {
  categories: Category[];
  loading: boolean;
  error: boolean;
  bySlug: (slug: string | undefined) => Category | undefined;
  retry: () => void;
}

const CategoriesContext = createContext<CategoriesState | null>(null);

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .categories()
      .then((res) => {
        if (cancelled) return;
        setCategories(res.categories.slice().sort((a, b) => a.sort - b.sort));
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const value = useMemo<CategoriesState>(
    () => ({
      categories,
      loading,
      error,
      bySlug: (slug) => categories.find((c) => c.slug === slug),
      retry: () => {
        setLoading(true);
        setAttempt((n) => n + 1);
      },
    }),
    [categories, loading, error],
  );

  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>;
}

export function useCategories(): CategoriesState {
  const ctx = useContext(CategoriesContext);
  if (!ctx) throw new Error('useCategories must be used inside <CategoriesProvider>');
  return ctx;
}
