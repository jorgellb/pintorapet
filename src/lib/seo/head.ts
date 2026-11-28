import { alternatePath, defaultLocale, type Locale } from '@/i18n/routes';

/**
 * Head tags shared by every public page (PublicLayout): which addresses a page
 * gives for itself in each language, and how it names its language.
 */

export const otherLocaleOf = (locale: Locale): Locale => (locale === 'en' ? 'es' : 'en');

/**
 * The page in the other language, for the header's language link: the
 * visitor keeps a filter or a page of reviews (?category=, ?p=), but not a
 * coupon link, which is for them and not for the page.
 */
export function visitorAlternateHref(pathname: string, search: string, locale: Locale): string {
  const params = new URLSearchParams(search);
  params.delete('cupon');
  params.delete('coupon');
  const query = params.size ? `?${params}` : '';
  return `${alternatePath(pathname, otherLocaleOf(locale))}${query}`;
}

/**
 * hreflang links: the page itself, its other-language version and x-default
 * (the English page, as in sitemap.xml: the site's root sends visitors there).
 * Addresses carry no query, like the canonical: a filtered list (?category=,
 * ?breed=) or a page of reviews (?p=) is the same page for search engines.
 */
export function hreflangLinks(input: {
  locale: Locale;
  /** This page's canonical URL. */
  canonical: string;
  /** The other-language page, a path or an absolute URL. */
  alternate: string;
  origin: string | URL;
}): Array<{ hreflang: string; href: string }> {
  const other = otherLocaleOf(input.locale);
  const alternate = new URL(input.alternate, input.origin);
  alternate.search = '';
  alternate.hash = '';
  const href = { [input.locale]: input.canonical, [other]: alternate.href } as Record<Locale, string>;
  return [
    { hreflang: input.locale, href: href[input.locale] },
    { hreflang: other, href: href[other] },
    { hreflang: 'x-default', href: href[defaultLocale] },
  ];
}

/** Open Graph locale names (language_TERRITORY). */
export const OG_LOCALES: Record<Locale, string> = { es: 'es_ES', en: 'en_GB' };
