import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { RATE, withinLimit } from '@/lib/server/rateLimit';
import { releaseLapsedCheckouts } from '@/lib/server/commerce/lapsed';
import { quoteRequestSchema } from '@/lib/validation/checkout';
import { CommerceError, internalError, jsonError } from '@/lib/server/commerce/errors';
import { hasDatabase } from '@/lib/server/db';
import { normalizeCartItems } from '@/lib/domain/cart';
import { loadManifestProducts } from '@/lib/catalog/loadProducts';
import { asCents, mulCents, addCents, formatEur } from '@/lib/domain/money';
import { ensureCartOwnerHash } from '@/lib/server/commerce/cartOwner';
import {
  createPersistedQuote,
  quoteCouponCtx,
  quotePublicPayload,
} from '@/lib/server/commerce/quotes';
import { serviceDb } from '@/lib/server/db';
import { customerSession } from '@/lib/server/account';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const { request, cookies } = context;
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new CommerceError('VALIDATION', 'Invalid JSON body', 400);
    }

    if (raw && typeof raw === 'object') {
      const banned = ['priceCents', 'unitAmountCents', 'total', 'subtotal', 'amount'];
      for (const key of banned) {
        if (key in raw) {
          throw new CommerceError(
            'FORBIDDEN',
            'Client-supplied prices are not accepted',
            400,
          );
        }
      }
    }

    const body = quoteRequestSchema.parse(raw);
    const items = normalizeCartItems(body.items);
    const { hash } = ensureCartOwnerHash(cookies);

    if (hasDatabase()) {
      const supabase = serviceDb();
      if (!supabase) {
        throw new CommerceError(
          'NOT_CONFIGURED',
          'Supabase service client unavailable',
          503,
        );
      }
      if (!(await withinLimit(RATE.quote, context))) {
        throw new CommerceError('RATE_LIMITED', 'Too many price checks from this connection; try again in a few minutes', 429);
      }
      // Checkouts whose time is up give their stock back, so the cart sees it (after the
      // answer). Never asking Stripe from here: a visitor's request must not make Stripe calls.
      waitUntil(
        releaseLapsedCheckouts(supabase, { askStripe: false }).catch((err: unknown) =>
          console.error('[cart quote] lapsed checkouts not released', err),
        ),
      );
      // Who is buying comes from the session; a typed email only counts if it is the account's own.
      const account = body.couponCode ? await customerSession(cookies, request) : null;
      const quote = await createPersistedQuote(supabase, {
        cartOwnerHash: hash,
        locale: body.locale,
        items,
        country: body.shippingCountry,
        postalCode: body.shippingPostalCode,
        pickupMarketId: body.pickupMarketId,
        invoice: body.invoice,
        couponCode: body.couponCode,
        couponCtx: quoteCouponCtx(account?.user ?? null, body.email),
      });
      return Response.json(quotePublicPayload(quote));
    }

    // Manifest-only quote (no persistence) until service role is configured.
    const catalog = await loadManifestProducts(body.locale);
    if (catalog.length === 0 && !hasDatabase()) {
      return Response.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message:
              'No product catalogue available. Configure Supabase or provide migration/products.json.',
          },
        },
        { status: 503 },
      );
    }

    const byId = new Map(catalog.map((p) => [p.id, p]));
    let subtotal = asCents(0);
    const lines = [];
    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product) {
        throw new CommerceError(
          'UNAVAILABLE',
          `Unknown product ${item.productId}`,
          404,
        );
      }
      const lineTotal = mulCents(asCents(product.priceCents), item.quantity);
      subtotal = addCents(subtotal, lineTotal);
      lines.push({
        productId: product.id,
        title: product.title,
        quantity: item.quantity,
        unitAmountCents: product.priceCents,
        lineTotalCents: lineTotal,
        availability: product.availability,
        saleEnabled: product.saleEnabled,
      });
    }

    return Response.json({
      quoteId: null,
      configured: false,
      currency: 'EUR',
      locale: body.locale,
      subtotalCents: subtotal,
      subtotalFormatted: formatEur(subtotal, body.locale),
      shippingPending: true,
      lines,
      message:
        'Manifest quote only — set SUPABASE_SERVICE_ROLE_KEY to persist quotes before checkout',
    });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(
        new CommerceError('VALIDATION', 'Invalid quote payload', 400, err),
      );
    }
    return internalError(err, 'Quote failed');
  }
};
