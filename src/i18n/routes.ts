export const locales = ['en', 'es'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

/** Semantic route keys → localized path segments (no leading/trailing slash). */
export const routeMap = {
  home: { en: '', es: '' },
  about: { en: 'about-me', es: 'sobre-mi' },
  work: { en: 'work', es: 'obra' },
  gallery: { en: 'gallery', es: 'galeria' },
  commissions: { en: 'commissions', es: 'encargos' },
  contact: { en: 'contact', es: 'contacto' },
  shop: { en: 'shop', es: 'tienda' },
  cart: { en: 'cart', es: 'carrito' },
  checkout: { en: 'checkout', es: 'finalizar-compra' },
  checkoutSuccess: { en: 'checkout/success', es: 'compra/confirmacion' },
  checkoutCancel: { en: 'checkout/cancel', es: 'compra/cancelada' },
  orderStatus: { en: 'order-status', es: 'estado-pedido' },
  privacy: { en: 'privacy', es: 'privacidad' },
  cookies: { en: 'cookies', es: 'cookies' },
  terms: { en: 'terms', es: 'condiciones' },
  shipping: { en: 'shipping-returns', es: 'envios-devoluciones' },
  accountHelp: { en: 'account-help', es: 'ayuda-compra' },
} as const;

export type RouteKey = keyof typeof routeMap;

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function localizedPath(
  locale: Locale,
  key: RouteKey,
  slug?: string,
): string {
  const segment = routeMap[key][locale];
  const base = segment ? `/${locale}/${segment}/` : `/${locale}/`;
  if (!slug) return base;
  return `${base}${slug}/`;
}

export function workPath(locale: Locale, slug: string): string {
  return localizedPath(locale, 'work', slug);
}

export function productPath(locale: Locale, slug: string): string {
  return localizedPath(locale, 'shop', slug);
}

/**
 * Same page in another locale, read from the current path. Section segments
 * are translated (contact ↔ contacto) and a trailing slug is kept as is.
 * Pages whose slug differs per locale (shop products) pass their own path.
 */
export function alternatePath(pathname: string, targetLocale: Locale): string {
  const [first = '', ...rest] = pathname.split('/').filter(Boolean);
  if (!isLocale(first)) return localizedPath(targetLocale, 'home');

  const remainder = rest.join('/');
  const keys = (Object.keys(routeMap) as RouteKey[])
    .filter((key) => key !== 'home')
    .sort((a, b) => routeMap[b][first].length - routeMap[a][first].length);

  for (const key of keys) {
    const segment = routeMap[key][first];
    if (remainder === segment) return localizedPath(targetLocale, key);
    if (remainder.startsWith(`${segment}/`)) {
      return localizedPath(targetLocale, key, remainder.slice(segment.length + 1));
    }
  }

  return localizedPath(targetLocale, 'home');
}

/** Build equivalent URL for the other locale, keeping a known slug pair when provided. */
export function switchLocalePath(
  _currentLocale: Locale,
  targetLocale: Locale,
  key: RouteKey,
  slugs?: { en: string; es: string },
): string {
  if (slugs) return localizedPath(targetLocale, key, slugs[targetLocale]);
  return localizedPath(targetLocale, key);
}
