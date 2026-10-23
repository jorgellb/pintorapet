import type { APIRoute } from 'astro';
import { checkoutCreateSchema } from '@/lib/validation/checkout';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { hasServiceSupabase } from '@/lib/server/env';
import { ensureCartOwnerHash } from '@/lib/server/commerce/cartOwner';
import { createCheckout } from '@/lib/server/commerce/checkout';
import { checkoutProviders } from '@/lib/server/payments/config';
import { createServiceClient } from '@/lib/server/supabase';
import { normalizeCartItems } from '@/lib/domain/cart';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = checkoutCreateSchema.parse(await request.json());

    if ('priceCents' in (body as object) || 'total' in (body as object)) {
      throw new CommerceError('FORBIDDEN', 'Client prices are not accepted', 400);
    }

    if (!hasServiceSupabase()) {
      return Response.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message:
              'Checkout requires PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
          },
        },
        { status: 503 },
      );
    }

    if (!(await checkoutProviders()).includes(body.provider)) {
      return Response.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message: `Checkout with ${body.provider} is not connected.`,
          },
        },
        { status: 503 },
      );
    }

    const supabase = createServiceClient();
    if (!supabase) {
      throw new CommerceError(
        'NOT_CONFIGURED',
        'Supabase service client unavailable',
        503,
      );
    }

    const { hash } = ensureCartOwnerHash(cookies);
    const session = await createCheckout(supabase, {
      provider: body.provider,
      quoteId: body.quoteId,
      attemptId: body.attemptId,
      cartOwnerHash: hash,
      locale: body.locale,
      items: body.items ? normalizeCartItems(body.items) : undefined,
    });

    return Response.json({
      url: session.url,
      sessionId: session.sessionId,
      orderId: session.orderId,
      reference: session.reference ?? null,
      accessToken: session.accessToken || null,
    });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(
        new CommerceError('VALIDATION', 'Invalid checkout payload', 400, err),
      );
    }
    return jsonError(new CommerceError('INTERNAL', 'Checkout create failed', 500));
  }
};
