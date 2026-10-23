import type { APIRoute } from 'astro';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import {
  constructStripeEvent,
  handleStripeEvent,
} from '@/lib/server/commerce/webhook';
import { hasServiceSupabase } from '@/lib/server/env';
import { loadPaymentConfig } from '@/lib/server/payments/config';
import { createServiceClient } from '@/lib/server/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { stripe } = await loadPaymentConfig();
  if (!stripe?.webhookSecret) {
    return Response.json(
      {
        error: {
          code: 'NOT_CONFIGURED',
          message: 'Stripe webhook secret / secret key not configured.',
        },
      },
      { status: 503 },
    );
  }

  if (!hasServiceSupabase()) {
    return Response.json(
      {
        error: {
          code: 'NOT_CONFIGURED',
          message: 'Webhook fulfillment requires SUPABASE_SERVICE_ROLE_KEY.',
        },
      },
      { status: 503 },
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return jsonError(
      new CommerceError('VALIDATION', 'Missing Stripe-Signature header', 400),
    );
  }

  try {
    const rawBody = await request.text();
    const event = await constructStripeEvent(rawBody, signature);
    const supabase = createServiceClient();
    if (!supabase) {
      throw new CommerceError(
        'NOT_CONFIGURED',
        'Supabase service client unavailable',
        503,
      );
    }
    const result = await handleStripeEvent(supabase, event);
    return Response.json({ received: true, ...result });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return jsonError(
      new CommerceError('INTERNAL', 'Webhook processing failed', 500, err),
    );
  }
};
