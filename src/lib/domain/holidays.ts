import type { Locale } from '@/i18n';

/**
 * "Order by … to have it before Christmas": each shipping zone has its last
 * day (Admin › Envíos). From 1 November the shop says how long is left; after
 * the date, until Christmas Eve, it warns that the parcel may arrive late.
 */
export type HolidayNotice = { kind: 'before'; deadline: string } | { kind: 'late' } | null;

/** Today's date in Spain (YYYY-MM-DD): the deadline is a Spanish calendar day. */
export function madridDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function holidayNotice(deadline: string | null | undefined, today: string = madridDay()): HolidayNotice {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const year = deadline.slice(0, 4);
  if (today < `${year}-11-01` || today >= `${year}-12-25`) return null;
  return today <= deadline ? { kind: 'before', deadline } : { kind: 'late' };
}

const dayName = (deadline: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
    .format(new Date(`${deadline}T12:00:00Z`))
    .replace(',', '');

/** The sentence for the cart, the checkout or a product page (with the zone when it is not the visitor's). */
export function holidayText(notice: Exclude<HolidayNotice, null>, locale: Locale, zone?: string): string {
  const es = locale === 'es';
  if (notice.kind === 'late') {
    return es
      ? 'Ya no podemos asegurar que llegue antes de Navidad.'
      : 'We can no longer promise it will arrive before Christmas.';
  }
  const day = dayName(notice.deadline, locale);
  if (zone) return es ? `Para Navidad (${zone}): pide hasta el ${day}.` : `For Christmas (${zone}): order by ${day}.`;
  return es ? `Pide hasta el ${day} para recibirlo antes de Navidad.` : `Order by ${day} to receive it before Christmas.`;
}
