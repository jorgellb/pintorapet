import { describe, expect, it } from 'vitest';
import type { Market } from '../src/lib/domain/markets';
import { productJsonLd } from '../src/lib/catalog/productJsonLd';
import type { ProductPublic } from '../src/lib/domain/types';
import {
  madridOffset,
  marketEventJsonLd,
  parseMarketHours,
  returnPolicyJsonLd,
  shippingDetailsJsonLd,
  siteJsonLd,
} from '../src/lib/seo/structuredData';

const ORIGIN = 'https://petsdrawings.com';

describe('siteJsonLd', () => {
  const graph = (siteJsonLd({ origin: ORIGIN, locale: 'es', logoUrl: 'https://res.cloudinary.com/demo/logo_png' }) as {
    '@graph': Array<Record<string, any>>;
  })['@graph'];
  const byType = (type: string) => graph.find((node) => node['@type'] === type)!;

  it('links the brand, the artist and the site', () => {
    const org = byType('Organization');
    const person = byType('Person');
    const site = byType('WebSite');
    expect(org['@id']).toBe(`${ORIGIN}/#organization`);
    expect(org.founder).toEqual({ '@id': person['@id'] });
    expect(person.worksFor).toEqual({ '@id': org['@id'] });
    expect(site.publisher).toEqual({ '@id': org['@id'] });
    expect(site.url).toBe(`${ORIGIN}/es/`);
    expect(person.url).toBe(`${ORIGIN}/es/sobre-mi/`);
    expect(person.name).toBe('Meili Stringfellow');
    expect(org.logo).toBe('https://res.cloudinary.com/demo/logo_png');
    expect(org.sameAs).toContain('https://www.instagram.com/petsdrawings_meili/');
  });

  it('leaves the logo out when there is none', () => {
    const noLogo = siteJsonLd({ origin: ORIGIN, locale: 'en' }) as { '@graph': Array<Record<string, any>> };
    expect(noLogo['@graph'][0]).not.toHaveProperty('logo');
  });
});

describe('returnPolicyJsonLd', () => {
  const countries = Array.from({ length: 96 }, (_, i) => `C${i}`);
  const policies = returnPolicyJsonLd({ countries, policyUrl: `${ORIGIN}/en/shipping-returns/` }) as Array<Record<string, any>>;

  it('states the shop’s terms: 14 days, by post, the customer pays unless the piece is faulty', () => {
    expect(policies[0]).toMatchObject({
      '@type': 'MerchantReturnPolicy',
      returnPolicyCountry: 'ES',
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 14,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
      itemDefectReturnFees: 'https://schema.org/FreeReturn',
      merchantReturnLink: `${ORIGIN}/en/shipping-returns/`,
    });
  });

  it('splits the countries in groups of at most 50', () => {
    expect(policies.map((p) => p.applicableCountry.length)).toEqual([50, 46]);
    expect(policies.flatMap((p) => p.applicableCountry)).toEqual(countries);
  });
});

describe('shippingDetailsJsonLd', () => {
  it('groups countries by rate, cheapest first', () => {
    const details = shippingDetailsJsonLd([
      { country: 'GB', cents: 1645 },
      { country: 'PT', cents: 1390 },
      { country: 'FR', cents: 1390 },
    ]) as Array<Record<string, any>>;
    expect(details).toEqual([
      {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: 13.9, currency: 'EUR' },
        shippingDestination: [
          { '@type': 'DefinedRegion', addressCountry: 'PT' },
          { '@type': 'DefinedRegion', addressCountry: 'FR' },
        ],
      },
      {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: 16.45, currency: 'EUR' },
        shippingDestination: [{ '@type': 'DefinedRegion', addressCountry: 'GB' }],
      },
    ]);
  });

  it('leaves out a country whose regions pay different rates, and places it does not ship to', () => {
    const details = shippingDetailsJsonLd([
      { country: 'ES', cents: 590 },
      { country: 'ES', cents: 790 },
      { country: 'PT', cents: 1390 },
      { country: 'US', cents: null },
    ]) as Array<Record<string, any>>;
    const countries = details.flatMap((d) => d.shippingDestination.map((r: { addressCountry: string }) => r.addressCountry));
    expect(countries).toEqual(['PT']);
  });

  it('keeps a country whose regions all pay the same, and free shipping', () => {
    const details = shippingDetailsJsonLd([
      { country: 'ES', cents: 0 },
      { country: 'ES', cents: 0 },
    ]) as Array<Record<string, any>>;
    expect(details).toHaveLength(1);
    expect(details[0]!.shippingRate.value).toBe(0);
  });
});

describe('parseMarketHours', () => {
  it('reads the usual ways of writing opening hours', () => {
    expect(parseMarketHours('13:00–16:00')).toEqual({ opens: '13:00', closes: '16:00' });
    expect(parseMarketHours('10.00 - 14.30')).toEqual({ opens: '10:00', closes: '14:30' });
    expect(parseMarketHours('10h a 14h')).toEqual({ opens: '10:00', closes: '14:00' });
    expect(parseMarketHours('9:30 to 21:00')).toEqual({ opens: '09:30', closes: '21:00' });
  });

  it('gives up on anything else', () => {
    expect(parseMarketHours('')).toBeNull();
    expect(parseMarketHours('all day')).toBeNull();
    expect(parseMarketHours('10:00–14:00 y 17:00–20:00')).toBeNull();
    expect(parseMarketHours('16:00–13:00')).toBeNull();
    expect(parseMarketHours('25:00–26:00')).toBeNull();
  });
});

describe('madridOffset', () => {
  it('follows Madrid’s winter and summer time', () => {
    expect(madridOffset('2026-11-29', '13:00')).toBe('+01:00');
    expect(madridOffset('2026-07-15', '10:00')).toBe('+02:00');
  });
});

describe('marketEventJsonLd', () => {
  const market: Market = {
    id: 'm1',
    name: 'CHRISTMAS FAYRE - Arboleas',
    place: 'Community Center',
    city: 'Arboleas',
    startsOn: '2026-11-29',
    endsOn: '2026-11-29',
    hours: '13:00–16:00',
    notesEs: '',
    notesEn: '',
    mapUrl: 'https://maps.example.com/x',
    pickup: false,
    published: true,
  };

  it('gives times with their offset, the plain name, the map and photos', () => {
    const event = marketEventJsonLd(market, {
      locale: 'es',
      origin: ORIGIN,
      description: 'Mercados.',
      images: ['https://res.cloudinary.com/demo/stall.jpg'],
    }) as Record<string, any>;
    expect(event).toMatchObject({
      '@type': 'Event',
      name: 'CHRISTMAS FAYRE - Arboleas',
      startDate: '2026-11-29T13:00:00+01:00',
      endDate: '2026-11-29T16:00:00+01:00',
      url: `${ORIGIN}/es/mercados/`,
      image: ['https://res.cloudinary.com/demo/stall.jpg'],
      description: 'Mercados.',
    });
    expect(event.location).toMatchObject({ name: 'Community Center', hasMap: 'https://maps.example.com/x' });
    expect(event.location.address).toMatchObject({ addressLocality: 'Arboleas', addressCountry: 'ES' });
  });

  it('keeps whole days when the hours cannot be read, and no image without photos', () => {
    const event = marketEventJsonLd(
      { ...market, hours: 'todo el día', endsOn: '2026-11-30', mapUrl: null },
      { locale: 'en', origin: ORIGIN, description: 'Markets.', images: [] },
    ) as Record<string, any>;
    expect(event.startDate).toBe('2026-11-29');
    expect(event.endDate).toBe('2026-11-30');
    expect(event).not.toHaveProperty('image');
    expect(event.location).not.toHaveProperty('hasMap');
  });
});

describe('productJsonLd offer extras', () => {
  const card = {
    id: 'p1',
    sku: 'PD-1',
    title: 'Tarjeta Pug',
    summary: 'Una tarjeta.',
    description: '',
    priceCents: 349,
    saleEnabled: true,
    availability: 'available',
    coverImageUrl: null,
    imageUrls: [],
  } as unknown as ProductPublic;

  it('adds shipping and returns to the offer only when given', () => {
    const shipping = shippingDetailsJsonLd([{ country: 'PT', cents: 990 }]);
    const returns = returnPolicyJsonLd({ countries: ['ES'], policyUrl: `${ORIGIN}/es/envios-devoluciones/` });
    const [withExtras] = productJsonLd({
      product: card,
      selected: card,
      url: `${ORIGIN}/es/tienda/tarjeta-pug/`,
      breadcrumbs: [],
      shippingDetails: shipping,
      returnPolicies: returns,
    }) as Array<Record<string, any>>;
    expect(withExtras!.offers.shippingDetails).toEqual(shipping);
    expect(withExtras!.offers.hasMerchantReturnPolicy).toEqual(returns);

    const [plain] = productJsonLd({ product: card, selected: card, url: `${ORIGIN}/x/`, breadcrumbs: [] }) as Array<Record<string, any>>;
    expect(plain!.offers).not.toHaveProperty('shippingDetails');
    expect(plain!.offers).not.toHaveProperty('hasMerchantReturnPolicy');
  });
});
