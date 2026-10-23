import type { APIRoute } from 'astro';
import { shippingEstimateSchema } from '@/lib/validation/checkout';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { normalizeCartItems } from '@/lib/domain/cart';
import { isShippingCountry } from '@/lib/domain/countries';
import { formatEur } from '@/lib/domain/money';
import { createServiceClient } from '@/lib/server/supabase';

export const prerender = false;

type ShippingQuote = {
  available: boolean;
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
    const supabase = createServiceClient();
    if (!supabase) throw new CommerceError('NOT_CONFIGURED', 'Shipping unavailable', 503);

    const items = normalizeCartItems(body.items);
    const { data, error } = await supabase.rpc('shipping_quote', {
      p_lines: items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
      p_country: body.country.toUpperCase(),
      p_postal_code: body.postalCode || null,
    });
    if (error) throw mapPgError(error);

    const q = data as ShippingQuote;
    if (!q.available) return Response.json({ available: false, reason: q.reason ?? 'NO_ZONE' });

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
    });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(new CommerceError(err.code, err.message, err.status));
    return jsonError(new CommerceError('VALIDATION', 'Invalid shipping request', 400));
  }
};
