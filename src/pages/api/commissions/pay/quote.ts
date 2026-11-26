import type { APIRoute } from 'astro';
import { z } from 'zod';
import { invoiceCustomerSchema } from '@/lib/domain/checkoutCustomer';
import { commissionCheckoutQuote } from '@/lib/server/commissionQuotes';
import { ensureCartOwnerHash } from '@/lib/server/commerce/cartOwner';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { formatEur } from '@/lib/domain/money';
import { serviceDb } from '@/lib/server/db';

export const prerender = false;

const bodySchema = z
  .object({
    reference: z.string().regex(/^CR-[A-Z0-9]{10}$/),
    token: z.string().min(16).max(128),
    locale: z.enum(['es', 'en']),
    country: z.string().regex(/^[A-Za-z]{2}$/),
    postalCode: z.string().trim().max(12).default(''),
    invoice: invoiceCustomerSchema.optional(),
  })
  .strict();

/** What the commission costs delivered to this destination (a checkout quote to pay). */
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = bodySchema.parse(await request.json());
    const service = serviceDb();
    if (!service) throw new CommerceError('NOT_CONFIGURED', 'Payments unavailable', 503);
    const { hash } = ensureCartOwnerHash(cookies);
    const quote = await commissionCheckoutQuote(service, { ...body, cartOwnerHash: hash });
    return Response.json({
      ...quote,
      shippingFormatted: formatEur(quote.shippingCents, body.locale),
      totalFormatted: formatEur(quote.totalCents, body.locale),
      subtotalFormatted: formatEur(quote.subtotalCents, body.locale),
    });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(new CommerceError(err.code, err.message, err.status));
    return jsonError(new CommerceError('VALIDATION', 'Invalid request', 400));
  }
};
