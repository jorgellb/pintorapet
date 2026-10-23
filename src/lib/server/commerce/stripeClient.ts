import Stripe from 'stripe';
import { loadPaymentConfig } from '@/lib/server/payments/config';

const clients = new Map<string, Stripe>();

export function stripeFor(secretKey: string): Stripe {
  let client = clients.get(secretKey);
  if (!client) {
    // Pin to the SDK's bundled OpenAPI version.
    client = new Stripe(secretKey, {
      apiVersion: '2026-09-30.endive',
      typescript: true,
    });
    clients.set(secretKey, client);
  }
  return client;
}

export async function getStripe(): Promise<Stripe | null> {
  const { stripe } = await loadPaymentConfig();
  return stripe ? stripeFor(stripe.secretKey) : null;
}
