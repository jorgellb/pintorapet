import type Stripe from 'stripe';
import type { Db } from '@/lib/server/db';
import { loadPaymentConfig } from '@/lib/server/payments/config';
import { stripeFor } from './stripeClient';

type Lapsed = { attempt_id: string; provider: string; stripe_session_id: string | null; ask_stripe: boolean };

/**
 * Frees the stock of checkouts whose time is up (public.lapsed_attempts), one
 * at a time so no two hold each other's locks. A Stripe session that ended
 * without its "expired" webhook is freed only once Stripe says it expired:
 * one that was paid (its webhook late) or is still being paid by a slow
 * method keeps its pieces. `askStripe: false` skips those, for callers that
 * cannot wait for Stripe (opening a checkout); the cron and the cart ask.
 */
export async function releaseLapsedCheckouts(service: Db, opts: { askStripe: boolean }): Promise<number> {
  const rows = await service.rows<Lapsed>`select * from public.lapsed_attempts()`;
  let stripe: Stripe | null = null;
  if (opts.askStripe && rows.some((row) => row.ask_stripe)) {
    const { stripe: config } = await loadPaymentConfig();
    stripe = config ? stripeFor(config.secretKey) : null;
  }
  let released = 0;
  for (const row of rows) {
    if (row.ask_stripe) {
      if (!stripe || !row.stripe_session_id) continue;
      const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id).catch((err: unknown) => {
        console.error('[checkout] Stripe session %s not read', row.stripe_session_id, err);
        return null;
      });
      if (session?.status !== 'expired') continue;
    }
    const reason = row.provider === 'paypal' ? 'paypal_expired' : row.ask_stripe ? 'stripe_session_expired' : 'lapsed';
    try {
      await service.run`select public.release_reservations(${row.attempt_id}, ${reason})`;
      released += 1;
    } catch (err) {
      console.error('[checkout] lapsed checkout %s not released', row.attempt_id, err);
    }
  }
  return released;
}
