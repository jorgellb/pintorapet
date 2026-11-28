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
 * method keeps its pieces, and is asked about again in 30 minutes at the
 * earliest (ten sessions a run). Only the cron asks Stripe (`askStripe`);
 * opening a checkout and pricing a cart free the others without waiting.
 */
export async function releaseLapsedCheckouts(service: Db, opts: { askStripe: boolean }): Promise<number> {
  const rows = await service.rows<Lapsed>`
    select * from public.lapsed_attempts(p_limit => 50, p_ask_limit => ${opts.askStripe ? 10 : 0})`;
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
      if (session?.status !== 'expired') {
        // Asked: not again for a while (lapsed_attempts waits 30 minutes).
        await service.run`update public.checkout_attempts set stripe_checked_at = now() where id = ${row.attempt_id}`
          .catch((err: unknown) => console.error('[checkout] check of %s not noted', row.attempt_id, err));
        continue;
      }
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
