import type { Locale } from '@/i18n';
import { formatEur } from '@/lib/domain/money';
import { holidayNotice, holidayText } from '@/lib/domain/holidays';
import { serviceDb } from '@/lib/server/db';

/**
 * What the shop can promise before the visitor says where it goes: the first
 * active zone's free shipping ("gratis a la Península desde 60 €") and its
 * Christmas date. Kept five minutes: every page carries the cart.
 */
type Zone = { name_es: string; name_en: string; free_over_cents: number | null; holiday_deadline: string | null };

const KEEP_MS = 5 * 60_000;
let cached: { at: number; value: Promise<{ free: Zone | null; holiday: Zone | null }> } | null = null;

async function load(): Promise<{ free: Zone | null; holiday: Zone | null }> {
  const db = serviceDb();
  if (!db) return { free: null, holiday: null };
  const zones = await db.rows<Zone>`
    select name_es, name_en, free_over_cents, holiday_deadline from public.shipping_zones
    where active order by position`;
  return {
    free: zones.find((z) => z.free_over_cents) ?? null,
    holiday: zones.find((z) => z.holiday_deadline) ?? null,
  };
}

/** A failed read shows no notices this time and is not kept, so the next page asks again. */
function zones() {
  if (!cached || Date.now() - cached.at > KEEP_MS) {
    const value: Promise<{ free: Zone | null; holiday: Zone | null }> = load().catch((err: unknown) => {
      console.error('[shipping] highlights read failed', err instanceof Error ? err.message : err);
      if (cached?.value === value) cached = null;
      return { free: null, holiday: null };
    });
    cached = { at: Date.now(), value };
  }
  return cached.value;
}

/** "60 €", not "60,00 €", for a round amount. */
const amount = (cents: number, locale: Locale) => formatEur(cents, locale).replace(/[.,]00(?=\D|$)/, '');

export type ShippingHighlights = { freeShipping: string | null; holiday: string | null };

export async function shippingHighlights(locale: Locale): Promise<ShippingHighlights> {
  const { free, holiday } = await zones();
  const es = locale === 'es';
  const name = (z: Zone) => (es ? z.name_es : z.name_en);
  const notice = holiday ? holidayNotice(holiday.holiday_deadline) : null;
  return {
    freeShipping: free?.free_over_cents
      ? es
        ? `Envío gratis desde ${amount(free.free_over_cents, locale)} (${name(free)})`
        : `Free shipping from ${amount(free.free_over_cents, locale)} (${name(free)})`
      : null,
    // Only while one can still order in time: "too late" belongs to the visitor's own zone.
    holiday: holiday && notice?.kind === 'before' ? holidayText(notice, locale, name(holiday)) : null,
  };
}
