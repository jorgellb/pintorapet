import type { Locale } from '@/i18n';

/** A market where Meili sets up her stall (Admin › Mercados). Dates are Spanish calendar days. */
export type Market = {
  id: string;
  name: string;
  place: string;
  city: string;
  startsOn: string;
  endsOn: string;
  hours: string;
  notesEs: string;
  notesEn: string;
  mapUrl: string | null;
  pickup: boolean;
  published: boolean;
  /** Photos from Medios, in order (Admin › Mercados). */
  photos?: MarketPhoto[];
};

export type MarketPhoto = { id: string; url: string; altEs: string; altEn: string };

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
const fmt = (locale: Locale, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-GB', { ...opts, timeZone: 'UTC' });

/** "sábado 12 de diciembre", "del 12 al 14 de diciembre", "12–14 December". */
export function marketDates(market: Pick<Market, 'startsOn' | 'endsOn'>, locale: Locale): string {
  const start = day(market.startsOn);
  const end = day(market.endsOn);
  if (market.startsOn === market.endsOn) {
    return fmt(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(start).replace(',', '');
  }
  const sameMonth = market.startsOn.slice(0, 7) === market.endsOn.slice(0, 7);
  if (locale === 'es') {
    const from = sameMonth ? fmt(locale, { day: 'numeric' }).format(start) : fmt(locale, { day: 'numeric', month: 'long' }).format(start);
    return `del ${from} al ${fmt(locale, { day: 'numeric', month: 'long' }).format(end)}`;
  }
  return sameMonth
    ? `${fmt(locale, { day: 'numeric' }).format(start)}–${fmt(locale, { day: 'numeric', month: 'long' }).format(end)}`
    : `${fmt(locale, { day: 'numeric', month: 'long' }).format(start)} – ${fmt(locale, { day: 'numeric', month: 'long' }).format(end)}`;
}

export function marketState(market: Pick<Market, 'startsOn' | 'endsOn'>, today: string): 'now' | 'soon' | 'past' {
  if (today > market.endsOn) return 'past';
  return today >= market.startsOn ? 'now' : 'soon';
}

/** Markets still to come (or on today), soonest first. */
export function upcoming<T extends Pick<Market, 'startsOn' | 'endsOn'>>(markets: T[], today: string): T[] {
  return markets.filter((m) => m.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

/** The change for a cash payment ("20", "50,00" €), or null when it does not cover the total. */
export function changeFor(totalCents: number, given: string): number | null {
  const raw = given.trim().replace(/\s|€/g, '').replace(',', '.');
  if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  return cents >= totalCents ? cents - totalCents : null;
}

/** "Faltan 16 días", "Mañana", "Hoy · 10:00–21:00": how far the market is. */
export function countdown(market: Pick<Market, 'startsOn' | 'endsOn' | 'hours'>, today: string, locale: Locale): string {
  const es = locale === 'es';
  if (marketState(market, today) === 'now') {
    const word = es ? 'Hoy' : 'Today';
    return market.hours ? `${word} · ${market.hours}` : word;
  }
  const days = Math.round((Date.parse(`${market.startsOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (days <= 1) return es ? 'Mañana' : 'Tomorrow';
  return es ? `Faltan ${days} días` : `In ${days} days`;
}
