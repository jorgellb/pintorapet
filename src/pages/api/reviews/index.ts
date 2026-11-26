import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { reviewInputSchema } from '@/lib/domain/reviews';
import { clientIp, inspect, withoutAntibotFields } from '@/lib/server/antibot';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { hasDatabase, serviceDb } from '@/lib/server/db';
import { parseRequestBody } from '@/lib/server/parseBody';
import { submitCustomerReview } from '@/lib/server/reviews/store';

export const prerender = false;

/** A plain form posts text: turn the number and the checkbox back into what the schema expects. */
function fromForm(raw: Record<string, unknown>): Record<string, unknown> {
  const body = { ...raw };
  if (typeof body.rating === 'string') body.rating = body.rating === '' ? null : Number(body.rating);
  if (body.productId === '') body.productId = null;
  if (body.consent === 'true' || body.consent === 'on' || body.consent === '1') body.consent = true;
  return body;
}

/**
 * The customer's review of their order: made, or changed while it is pending
 * and Meili has not touched it. Their photos come next (api/reviews/photos).
 * Whatever is wrong with the link, the answer is the same.
 */
export const POST: APIRoute = async (context) => {
  try {
    const raw = await parseRequestBody(context.request);
    const input = reviewInputSchema.parse(fromForm(withoutAntibotFields(raw)));

    const { verdict } = await inspect({
      form: 'review',
      fields: raw,
      ip: clientIp(context),
      name: input.authorName,
      message: input.body,
    });
    if (verdict === 'rate') return jsonError(new CommerceError('RATE_LIMITED', 'Too many requests', 429));
    // Bots get the answer a person would get, so they learn nothing.
    if (verdict === 'block') return Response.json({ ok: true, id: randomUUID(), created: true });

    if (!hasDatabase() || !serviceDb()) throw new CommerceError('NOT_CONFIGURED', 'Reviews are not available', 503);
    const result = await submitCustomerReview(input, { ip: clientIp(context) });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(new CommerceError(err.code, err.message, err.status));
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(new CommerceError('VALIDATION', 'Invalid review', 400));
    }
    console.error('[review]', err);
    return jsonError(new CommerceError('INTERNAL', 'Review failed', 500));
  }
};
