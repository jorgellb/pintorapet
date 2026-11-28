import type { APIRoute } from 'astro';
import { z } from 'zod';
import { checkoutCustomerSchema, shippingAddressFrom } from '@/lib/domain/checkoutCustomer';
import { commissionConfig, commissionManualOrder } from '@/lib/server/commissionQuotes';
import { CommerceError, internalError, jsonError } from '@/lib/server/commerce/errors';
import { serviceDb } from '@/lib/server/db';

export const prerender = false;

const bodySchema = z
  .object({
    reference: z.string().regex(/^CR-[A-Z0-9]{10}$/),
    token: z.string().min(16).max(128),
    method: z.enum(['bizum', 'transfer']),
    quoteId: z.uuid(),
    customer: checkoutCustomerSchema,
  })
  .strict();

/** Pay a commission by Bizum or bank transfer: the order waits for the money. */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = bodySchema.parse(await request.json());
    const service = serviceDb();
    if (!service) throw new CommerceError('NOT_CONFIGURED', 'Payments unavailable', 503);
    const config = await commissionConfig(service);
    if (body.method === 'transfer' && !config.transferIban) {
      throw new CommerceError('VALIDATION', 'Transfer is not available', 400);
    }
    const order = await commissionManualOrder(service, {
      reference: body.reference,
      token: body.token,
      method: body.method,
      quoteId: body.quoteId,
      customer: { name: body.customer.name, email: body.customer.email, phone: body.customer.phone },
      address: shippingAddressFrom(body.customer) as unknown as Record<string, string>,
    });
    return Response.json({
      ok: true,
      ...order,
      ...(body.method === 'transfer' ? { iban: config.transferIban, holder: config.transferHolder } : {}),
    });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    // A body that is not JSON, or not the expected shape.
    if (err instanceof SyntaxError || (err && typeof err === 'object' && 'issues' in err)) {
      return jsonError(new CommerceError('VALIDATION', 'Invalid request', 400));
    }
    return internalError(err, 'Commission order failed');
  }
};
