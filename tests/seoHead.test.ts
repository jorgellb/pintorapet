import { describe, expect, it } from 'vitest';
import { hreflangLinks, visitorAlternateHref } from '../src/lib/seo/head';

const ORIGIN = 'https://petsdrawings.com';

describe('hreflangLinks', () => {
  it('names the page, its other language and x-default (the English page)', () => {
    expect(
      hreflangLinks({ locale: 'es', canonical: `${ORIGIN}/es/tienda/`, alternate: '/en/shop/', origin: ORIGIN }),
    ).toEqual([
      { hreflang: 'es', href: `${ORIGIN}/es/tienda/` },
      { hreflang: 'en', href: `${ORIGIN}/en/shop/` },
      { hreflang: 'x-default', href: `${ORIGIN}/en/shop/` },
    ]);
  });

  it('drops filters and review pages from the other-language address, like the canonical', () => {
    const links = hreflangLinks({
      locale: 'en',
      canonical: `${ORIGIN}/en/shop/`,
      alternate: '/es/tienda/?category=mugs&breed=pug#stall',
      origin: ORIGIN,
    });
    expect(links.map((l) => l.href)).toEqual([`${ORIGIN}/en/shop/`, `${ORIGIN}/es/tienda/`, `${ORIGIN}/en/shop/`]);
    expect(hreflangLinks({ locale: 'en', canonical: `${ORIGIN}/en/contact/`, alternate: '/es/contacto/?p=2', origin: ORIGIN })[1])
      .toEqual({ hreflang: 'es', href: `${ORIGIN}/es/contacto/` });
  });
});

describe('visitorAlternateHref', () => {
  it('keeps the visitor’s filter in the language link but not a coupon', () => {
    expect(visitorAlternateHref('/en/shop/', '?category=mugs&cupon=HOLA', 'en')).toBe('/es/tienda/?category=mugs');
    expect(visitorAlternateHref('/es/contacto/', '?coupon=X', 'es')).toBe('/en/contact/');
  });
});
