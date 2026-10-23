import type { APIRoute } from 'astro';
import { z } from 'zod';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { hasServiceSupabase } from '@/lib/server/env';
import { createServiceClient } from '@/lib/server/supabase';
import { formatEur } from '@/lib/domain/money';
import { trackingUrl } from '@/lib/server/shipping/correos';

export const prerender = false;

const bodySchema = z
  .object({
    reference: z.string().trim().min(4).max(64),
    accessToken: z.string().trim().min(24).max(200),
    locale: z.enum(['en', 'es']).optional(),
  })
  .strict();

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!hasServiceSupabase()) {
      return Response.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message: 'Order lookup requires SUPABASE_SERVICE_ROLE_KEY.',
          },
        },
        { status: 503 },
      );
    }

    const body = bodySchema.parse(await request.json());
    const supabase = createServiceClient();
    if (!supabase) {
      throw new CommerceError(
        'NOT_CONFIGURED',
        'Supabase service client unavailable',
        503,
      );
    }

    const { data, error } = await supabase.rpc('lookup_guest_order', {
      p_reference: body.reference,
      p_access_token: body.accessToken,
    });

    if (error) {
      const mapped = mapPgError(error);
      if (
        mapped.message.includes('ORDER_LOOKUP_DENIED') ||
        mapped.message.includes('INVALID_LOOKUP')
      ) {
        return jsonError(
          new CommerceError(
            'FORBIDDEN',
            'Order not found or access token invalid',
            404,
          ),
        );
      }
      throw mapped;
    }

    const row = data as {
      reference: string;
      payment_status: string;
      fulfillment_status: string;
      locale: 'en' | 'es';
      total_cents: number;
      subtotal_cents: number;
      shipping_cents: number;
      tax_cents: number;
      customer_email: string | null;
      customer_name: string | null;
      paid_at: string | null;
      created_at: string;
      shipping_zone_name: string | null;
      carrier: string | null;
      tracking_code: string | null;
      shipped_at: string | null;
      items: Array<{
        title: string;
        sku: string;
        quantity: number;
        unit_price_cents: number;
        line_subtotal_cents: number;
      }>;
    };

    const locale = body.locale ?? row.locale ?? 'en';

    return Response.json({
      reference: row.reference,
      paymentStatus: row.payment_status,
      fulfillmentStatus: row.fulfillment_status,
      customerEmail: row.customer_email,
      customerName: row.customer_name,
      paidAt: row.paid_at,
      createdAt: row.created_at,
      shipping: {
        zoneName: row.shipping_zone_name,
        carrier: row.carrier === 'correos' ? 'Correos' : row.carrier,
        trackingCode: row.tracking_code,
        trackingUrl:
          row.carrier === 'correos' && row.tracking_code ? trackingUrl(row.tracking_code, locale) : null,
        shippedAt: row.shipped_at,
      },
      totals: {
        subtotalCents: row.subtotal_cents,
        shippingCents: row.shipping_cents,
        taxCents: row.tax_cents,
        totalCents: row.total_cents,
        totalFormatted: formatEur(row.total_cents, locale),
      },
      items: (row.items ?? []).map((i) => ({
        title: i.title,
        sku: i.sku,
        quantity: i.quantity,
        unitAmountCents: i.unit_price_cents,
        lineTotalCents: i.line_subtotal_cents,
        lineTotalFormatted: formatEur(i.line_subtotal_cents, locale),
      })),
    });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(
        new CommerceError('VALIDATION', 'Invalid lookup payload', 400, err),
      );
    }
    return jsonError(new CommerceError('INTERNAL', 'Order lookup failed', 500));
  }
};
