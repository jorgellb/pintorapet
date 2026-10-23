import type { APIRoute } from 'astro';
import { checkoutCreateSchema } from '@/lib/validation/checkout';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { hasServiceSupabase } from '@/lib/server/env';
import { ensureCartOwnerHash } from '@/lib/server/commerce/cartOwner';
import { createCheckout } from '@/lib/server/commerce/checkout';
import { checkoutProviders } from '@/lib/server/payments/config';
import { createServiceClient } from '@/lib/server/supabase';
import { normalizeCartItems } from '@/lib/domain/cart';
import { customerSession, loadProfile, saveProfile } from '@/lib/server/account';

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
    const account = await customerSession(cookies, request);
    const session = await createCheckout(supabase, {
      provider: body.provider,
      quoteId: body.quoteId,
      attemptId: body.attemptId,
      cartOwnerHash: hash,
      locale: body.locale,
      items: body.items ? normalizeCartItems(body.items) : undefined,
      customer: body.customer,
      customerId: account?.user.id,
    });

    if (account && body.customer && body.saveToProfile) {
      // Best effort: a failed profile save never blocks the payment.
      const profile = await loadProfile(account).catch(() => null);
      if (profile) {
        await saveProfile(account, {
          ...profile,
          full_name: body.customer.name,
          phone: body.customer.phone,
          address: {
            line1: body.customer.line1,
            line2: body.customer.line2,
            city: body.customer.city,
            state: body.customer.state,
            postal_code: body.customer.postalCode,
            country: body.customer.country,
          },
        }).catch(() => false);
      }
    }

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
