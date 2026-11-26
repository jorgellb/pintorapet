import type { APIRoute } from 'astro';
import { shippingEstimateSchema } from '@/lib/validation/checkout';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { normalizeCartItems } from '@/lib/domain/cart';
import { isShippingCountry } from '@/lib/domain/countries';
import { formatEur } from '@/lib/domain/money';
import { json, serviceDb } from '@/lib/server/db';
import { holidayNotice, holidayText } from '@/lib/domain/holidays';

export const prerender = false;

type ShippingQuote = {
  available: boolean;
  zone_id?: string;
  reason?: string;
  zone_name_es?: string;
  zone_name_en?: string;
  delivery_es?: string;
  delivery_en?: string;
  shipping_cents?: number;
  subtotal_cents?: number;
  free_over_cents?: number | null;
  weight_grams?: number;
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = shippingEstimateSchema.parse(await request.json().catch(() => null));
    if (!isShippingCountry(body.country)) {
      return Response.json({ available: false, reason: 'NO_ZONE' });
    }
    const supabase = serviceDb();
    if (!supabase) throw new CommerceError('NOT_CONFIGURED', 'Shipping unavailable', 503);

    const items = normalizeCartItems(body.items);
    const lines = items.map((i) => ({ product_id: i.productId, quantity: i.quantity }));
    const q = (
      await dbCall(() => supabase.one<{ result: ShippingQuote }>`
        select public.shipping_quote(
          p_lines => array(select l from jsonb_populate_recordset(null::public.cart_line_input, ${json(lines)}) l),
          p_country => ${body.country.toUpperCase()}, p_postal_code => ${body.postalCode || null}) as result`)
    )!.result;
    if (!q.available) return Response.json({ available: false, reason: q.reason ?? 'NO_ZONE' });

    const zone = q.zone_id
      ? await supabase.one<{ holiday_deadline: string | null }>`
          select holiday_deadline from public.shipping_zones where id = ${q.zone_id}`.catch(() => null)
      : null;
    const holiday = holidayNotice(zone?.holiday_deadline);

    const es = body.locale === 'es';
    const cents = q.shipping_cents ?? 0;
    const freeOver = q.free_over_cents ?? null;
    const remaining = freeOver !== null && cents > 0 ? Math.max(freeOver - (q.subtotal_cents ?? 0), 0) : null;
    return Response.json({
      available: true,
      zoneName: es ? q.zone_name_es : q.zone_name_en,
      delivery: es ? q.delivery_es : q.delivery_en,
      shippingCents: cents,
      shippingFormatted: formatEur(cents, body.locale),
      freeOverCents: freeOver,
      remainingForFreeCents: remaining,
      remainingForFreeFormatted: remaining !== null ? formatEur(remaining, body.locale) : null,
      // Reached the zone's free shipping (not a zone that is always free).
      freeReached: freeOver !== null && cents === 0,
      holiday: holiday ? { late: holiday.kind === 'late', text: holidayText(holiday, body.locale) } : null,
    });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(new CommerceError(err.code, err.message, err.status));
    return jsonError(new CommerceError('VALIDATION', 'Invalid shipping request', 400));
  }
};
