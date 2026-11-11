import type { APIRoute } from 'astro';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { finalizePaypalOrder } from '@/lib/server/commerce/paypalCheckout';
import { paypalRefundOf, recordProviderRefund } from '@/lib/server/commerce/refunds';
import { loadPaymentConfig } from '@/lib/server/payments/config';
import { verifyPaypalWebhook } from '@/lib/server/payments/paypal';
import { createServiceClient } from '@/lib/server/supabase';

export const prerender = false;

type PaypalEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    status?: string;
    amount?: { value?: string };
    links?: Array<{ rel?: string; href?: string }>;
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

    // A refund: ours (confirmed), or made in the PayPal dashboard.
    if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
      const refund = paypalRefundOf(event.resource ?? {});
      if (!refund) return Response.json({ received: true, ignored: event.event_type });
      const result = await recordProviderRefund(supabase, 'paypal', refund.captureId, refund.refundId, refund.cents);
      return Response.json({ received: true, status: result });
    }
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
