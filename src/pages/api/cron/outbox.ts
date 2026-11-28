import type { APIRoute } from 'astro';
import { CommerceError, internalError, jsonError } from '@/lib/server/commerce/errors';
import { processOutboxBatch } from '@/lib/server/commerce/outbox';
import { hasResend } from '@/lib/server/env';
import { hasDatabase } from '@/lib/server/db';
import { serviceDb } from '@/lib/server/db';
import { syncOpenShipments } from '@/lib/server/shipping/trackingSync';
import { purgeExpiredData } from '@/lib/server/retention';
import { releaseLapsedCheckouts } from '@/lib/server/commerce/lapsed';

export const prerender = false;

async function run(request: Request): Promise<Response> {
  const secret = import.meta.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when configured.
  if (!secret || auth !== `Bearer ${secret}`) {
    return jsonError(new CommerceError('FORBIDDEN', 'Unauthorized cron', 401));
  }

  // `?quick=1` (every few minutes, .github/workflows/outbox.yml): stock and emails only.
  // The daily run (Vercel Cron) also asks Correos about parcels and forgets old data.
  const quick = new URL(request.url).searchParams.has('quick');

  // Checkouts whose time is up give their stock back (PayPal and Stripe).
  const tracker = serviceDb();
  if (tracker) {
    await releaseLapsedCheckouts(tracker, { askStripe: true }).catch((err: unknown) => console.error('lapsed checkouts cron', err));
  }
  // Parcels on their way: their Correos state (nothing to do when Correos is not connected).
  if (tracker && !quick) await syncOpenShipments(tracker).catch((err) => console.error('tracking cron', err));
  // Personal data past its retention period (see the privacy page).
  if (tracker && !quick) {
    await purgeExpiredData(tracker)
      .then((counts) => console.log('[retention] %s', JSON.stringify(counts)))
      .catch((err) => console.error('retention cron', err));
  }

  if (!hasDatabase() || !hasResend()) {
    return Response.json(
      {
        error: {
          code: 'NOT_CONFIGURED',
          message: 'Outbox cron needs service role + RESEND_API_KEY',
        },
      },
      { status: 503 },
    );
  }

  try {
    const supabase = serviceDb();
    if (!supabase) {
      throw new CommerceError(
        'NOT_CONFIGURED',
        'Supabase service client unavailable',
        503,
      );
    }
    const result = await processOutboxBatch(supabase, 25);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return internalError(err, 'Outbox cron failed');
  }
}

export const GET: APIRoute = async ({ request }) => run(request);
export const POST: APIRoute = async ({ request }) => run(request);
