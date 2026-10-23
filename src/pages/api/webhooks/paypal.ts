import type { APIRoute } from 'astro';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { finalizePaypalOrder } from '@/lib/server/commerce/paypalCheckout';
import { loadPaymentConfig } from '@/lib/server/payments/config';
import { verifyPaypalWebhook } from '@/lib/server/payments/paypal';
import { createServiceClient } from '@/lib/server/supabase';

export const prerender = false;

type PaypalEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
};

export const POST: APIRoute = async ({ request }) => {
  const { paypal } = await loadPaymentConfig();
  const supabase = createServiceClient();
  if (!paypal?.webhookId || !supabase) {
    return jsonError(new CommerceError('NOT_CONFIGURED', 'PayPal webhook not configured', 503));
  }

  try {
    const rawBody = await request.text();
    const verified = await verifyPaypalWebhook(paypal, paypal.webhookId, request.headers, rawBody);
    if (!verified) {
      return jsonError(new CommerceError('VALIDATION', 'Invalid PayPal signature', 400));
    }

    const event = JSON.parse(rawBody) as PaypalEvent;
    const orderId =
      event.event_type === 'CHECKOUT.ORDER.APPROVED'
        ? event.resource?.id
        : event.event_type === 'PAYMENT.CAPTURE.COMPLETED'
          ? event.resource?.supplementary_data?.related_ids?.order_id
          : undefined;

    if (!orderId) {
      return Response.json({ received: true, ignored: event.event_type });
    }

    const outcome = await finalizePaypalOrder(supabase, paypal, orderId);
    return Response.json({ received: true, status: outcome.status });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return jsonError(new CommerceError('INTERNAL', 'PayPal webhook failed', 500));
  }
};
