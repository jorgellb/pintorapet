import type { APIRoute } from 'astro';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { processOutboxBatch } from '@/lib/server/commerce/outbox';
import { hasResend, hasServiceSupabase } from '@/lib/server/env';
import { createServiceClient } from '@/lib/server/supabase';

export const prerender = false;

async function run(request: Request): Promise<Response> {
  const secret = import.meta.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when configured.
  if (!secret || auth !== `Bearer ${secret}`) {
    return jsonError(new CommerceError('FORBIDDEN', 'Unauthorized cron', 401));
  }

  await createServiceClient()?.rpc('release_expired_paypal_attempts');

  if (!hasServiceSupabase() || !hasResend()) {
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
    const supabase = createServiceClient();
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
    return jsonError(new CommerceError('INTERNAL', 'Outbox cron failed', 500));
  }
}

export const GET: APIRoute = async ({ request }) => run(request);
export const POST: APIRoute = async ({ request }) => run(request);
