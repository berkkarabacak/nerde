// Per-route metadata + JSON-LD (SEO_STRATEGY.md §2.2, §3, §4).
//
// Layering note (P1-05+, §2.3): the SERVER now injects the same title/
// description/canonical/OG/JSON-LD into the HTML shell for `/`, `/c/:slug`
// and `/place/:slug` (server/meta.ts, used by serve.ts in prod and the vite
// plugin in dev) — that is the crawler/unfurler baseline. This client module
// stays authoritative for SPA in-app navigations (where no new HTML is served)
// and for non-indexable routes (noindex states, /add, /saved, /login…).
const SITE_URL = 'https://nerde.com';
const SITE_NAME = 'Nerde';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

export interface SeoInput {
  title: string;
  description?: string;
  /** Absolute canonical URL; pass a path and it will be prefixed with the site URL. */
  canonical?: string;
  /** e.g. "noindex,follow" — defaults to index,follow. */
  robots?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[] | null;
  ogType?: string;
  ogImage?: string | null;
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/** Hard budgets from SEO_STRATEGY §4. */
export function clampTitle(title: string): string {
  if (title.length <= 65) return title;
  const cut = title.slice(0, 65);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > 40 ? cut.slice(0, boundary) : cut).trim();
}

export function clampDescription(description: string): string {
  if (description.length <= 165) return description;
  const cut = description.slice(0, 165);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > 100 ? cut.slice(0, boundary) : cut).trim();
}

export function absoluteUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function setMeta(input: SeoInput): void {
  const title = clampTitle(input.title);
  const canonical = absoluteUrl(input.canonical ?? window.location.pathname);
  const robots = input.robots ?? 'index,follow';
  const ogImage = input.ogImage ? absoluteUrl(input.ogImage) : DEFAULT_OG_IMAGE;

  document.title = title;
  if (input.description) upsertMeta('name', 'description', clampDescription(input.description));
  upsertMeta('name', 'robots', robots);
  upsertCanonical(canonical);

  upsertMeta('property', 'og:site_name', SITE_NAME);
  upsertMeta('property', 'og:title', title);
  if (input.description) upsertMeta('property', 'og:description', clampDescription(input.description));
  upsertMeta('property', 'og:url', canonical);
  upsertMeta('property', 'og:type', input.ogType ?? 'website');
  upsertMeta('property', 'og:image', ogImage);
  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:title', title);
  if (input.description) upsertMeta('name', 'twitter:description', clampDescription(input.description));

  // JSON-LD: replace previous route-specific blocks.
  document.head.querySelectorAll('script[data-nerde-jsonld]').forEach((el) => el.remove());
  const blocks = Array.isArray(input.jsonLd) ? input.jsonLd : input.jsonLd ? [input.jsonLd] : [];
  for (const block of blocks) {
    if (!block) continue;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-nerde-jsonld', '1');
    script.textContent = JSON.stringify(block);
    document.head.appendChild(script);
  }
}

// ---- JSON-LD templates (SEO_STRATEGY §3) ----

export function websiteJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Nerde',
    alternateName: 'Nerde.com',
    url: `${SITE_URL}/`,
    description:
      'Specialized maps for highly specific categories of physical places — calisthenics parks, vanlife spots, arm wrestling clubs and more.',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://nerde.com/?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  };
}
