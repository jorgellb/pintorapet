import { localizedPath, type Locale } from '@/i18n/routes';
import type { Market } from '@/lib/domain/markets';

/**
 * schema.org data (JSON-LD) for search engines, besides the product's own
 * (catalog/productJsonLd.ts): who is behind the site, the shop's return
 * policy and shipping rates, and the markets as events.
 */

export const BRAND = {
  name: 'Pets Drawings',
  alternateName: 'Pets Drawings by Meili',
  artist: 'Meili Stringfellow',
  email: 'info@petsdrawings.com',
  telephone: '+34 636 386 531',
  /** The same profiles as the contact page. */
  sameAs: [
    'https://www.instagram.com/petsdrawings_meili/',
    'https://www.facebook.com/people/Pets-Drawings-by-Meili/100089998232163/',
  ],
} as const;

const abs = (path: string, origin: string | URL) => new URL(path, origin).href;

/** The brand (Organization), the artist (Person) and the site (WebSite), linked by @id. */
export function siteJsonLd(input: { origin: string | URL; locale: Locale; logoUrl?: string | null }): object {
  const { origin, locale } = input;
  const es = locale === 'es';
  const root = abs('/', origin);
  const home = abs(localizedPath(locale, 'home'), origin);
  const about = abs(localizedPath(locale, 'about'), origin);
  const organization = `${root}#organization`;
  const artist = `${about}#artist`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organization,
        name: BRAND.name,
        alternateName: BRAND.alternateName,
        url: root,
        ...(input.logoUrl ? { logo: abs(input.logoUrl, origin) } : {}),
        email: BRAND.email,
        telephone: BRAND.telephone,
        address: { '@type': 'PostalAddress', addressCountry: 'ES' },
        sameAs: [...BRAND.sameAs],
        founder: { '@id': artist },
      },
      {
        '@type': 'Person',
        '@id': artist,
        name: BRAND.artist,
        jobTitle: es ? 'Retratista a lápiz' : 'Pencil portrait artist',
        url: about,
        worksFor: { '@id': organization },
      },
      {
        '@type': 'WebSite',
        '@id': `${home}#website`,
        url: home,
        name: BRAND.name,
        alternateName: BRAND.alternateName,
        inLanguage: locale,
        publisher: { '@id': organization },
      },
    ],
  };
}

/** Google reads at most 50 countries per return policy. */
const POLICY_COUNTRIES_MAX = 50;

/**
 * Returns of shop products (none is made to the customer's order): 14 days
 * from delivery, sent back by post at the customer's cost, free when the
 * piece arrived faulty. One policy object per 50 destination countries.
 */
export function returnPolicyJsonLd(input: { countries: readonly string[]; policyUrl: string }): object[] {
  const chunks: string[][] = [];
  for (let i = 0; i < input.countries.length; i += POLICY_COUNTRIES_MAX) {
    chunks.push(input.countries.slice(i, i + POLICY_COUNTRIES_MAX));
  }
  return chunks.map((countries) => ({
    '@type': 'MerchantReturnPolicy',
    applicableCountry: countries,
    returnPolicyCountry: 'ES',
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: 14,
    returnMethod: 'https://schema.org/ReturnByMail',
    returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
    itemDefectReturnFees: 'https://schema.org/FreeReturn',
    merchantReturnLink: input.policyUrl,
  }));
}

/** What checkout charges to send one unit to a destination; null when it cannot ship there. */
export type DestinationRate = { country: string; cents: number | null };

/**
 * Shipping rates as OfferShippingDetails, one per price with its countries.
 * Google only reads whole countries here (regions and postal codes only for
 * a few countries, not Spain), so a country whose regions pay different
 * rates (the Spanish mainland and the islands) is left out rather than
 * given a rate that is wrong for part of it.
 */
export function shippingDetailsJsonLd(rates: readonly DestinationRate[]): object[] {
  const byCountry = new Map<string, Set<number | null>>();
  for (const rate of rates) {
    const seen = byCountry.get(rate.country) ?? new Set<number | null>();
    seen.add(rate.cents);
    byCountry.set(rate.country, seen);
  }
  const byPrice = new Map<number, string[]>();
  for (const [country, prices] of byCountry) {
    if (prices.size !== 1) continue;
    const [cents] = [...prices];
    if (cents === null || cents === undefined) continue;
    byPrice.set(cents, [...(byPrice.get(cents) ?? []), country]);
  }
  return [...byPrice.entries()]
    .sort(([a], [b]) => a - b)
    .map(([cents, countries]) => ({
      '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: cents / 100, currency: 'EUR' },
      shippingDestination: countries.map((country) => ({ '@type': 'DefinedRegion', addressCountry: country })),
    }));
}

/**
 * Opening and closing time from a market's hours as Admin writes them
 * ("13:00–16:00", "10.00 - 14.30", "10h a 14h"); null for anything else
 * ("all day", two sessions…), and the event keeps whole days.
 */
export function parseMarketHours(hours: string): { opens: string; closes: string } | null {
  const match = hours
    .trim()
    .match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*h?\s*(?:-|–|—|a|to)\s*(\d{1,2})(?:[:.h](\d{2}))?\s*h?$/i);
  if (!match) return null;
  const time = (h: string, m: string | undefined) => {
    const hour = Number(h);
    const minute = Number(m ?? '0');
    return hour <= 23 && minute <= 59 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : null;
  };
  const opens = time(match[1]!, match[2]);
  const closes = time(match[3]!, match[4]);
  if (!opens || !closes || closes <= opens) return null;
  return { opens, closes };
}

/** Madrid's UTC offset ("+01:00", "+02:00" in summer) at a local date and time. */
export function madridOffset(day: string, time: string): string {
  // The local time read as UTC is an hour or two off, which only matters on the night the clocks change.
  const instant = new Date(`${day}T${time}:00Z`);
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  const offset = name?.replace('GMT', '') ?? '';
  return /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : '+00:00';
}

/** A market as a schema.org Event: times when its hours can be read, photos from the stall. */
export function marketEventJsonLd(
  market: Market,
  input: { locale: Locale; origin: string | URL; description: string; images: readonly string[] },
): object {
  const es = input.locale === 'es';
  const hours = parseMarketHours(market.hours);
  const at = (day: string, time: string | undefined) => (time ? `${day}T${time}:00${madridOffset(day, time)}` : day);
  const page = abs(localizedPath(input.locale, 'markets'), input.origin);
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: market.name,
    startDate: at(market.startsOn, hours?.opens),
    endDate: at(market.endsOn, hours?.closes),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    url: page,
    location: {
      '@type': 'Place',
      name: market.place || market.name,
      address: { '@type': 'PostalAddress', addressLocality: market.city || undefined, addressCountry: 'ES' },
      ...(market.mapUrl ? { hasMap: market.mapUrl } : {}),
    },
    ...(input.images.length ? { image: [...input.images] } : {}),
    organizer: { '@type': 'Person', name: BRAND.artist, url: abs(localizedPath(input.locale, 'home'), input.origin) },
    description: (es ? market.notesEs : market.notesEn) || input.description,
  };
}
