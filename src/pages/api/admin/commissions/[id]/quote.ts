import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { quoteSchema, sendQuote } from '@/lib/server/commissionQuotes';
import { serviceDb } from '@/lib/server/db';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Quote a commission and email the customer the link to pay it. */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const input = quoteSchema.parse(await request.json());
    const service = serviceDb();
    if (!service) throw new Error('No database');
    const out = await sendQuote(admin.db, service, id, input);
    await audit(admin, 'send_commission_quote', 'commission_requests', id, { priceCents: input.priceCents, emailed: out.emailed });
    return Response.json({ ok: true, ...out });
  } catch (err) {
    return failure(err, 'No se pudo enviar el presupuesto.');
  }
};
