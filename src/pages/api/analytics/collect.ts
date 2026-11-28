import type { APIRoute } from 'astro';
import { recordVisit } from '@/lib/analytics/record';
import { RATE, withinLimit } from '@/lib/server/rateLimit';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  try {
    const body = (await context.request.json()) as Record<string, unknown>;
    // Past the limit a connection's page views are not stored (a script, not a reader).
    if (await withinLimit(RATE.pageView, context)) await recordVisit(context.request, body);
  } catch {
    // A missed page view should never surface as an error to the visitor.
  }
  return new Response(null, { status: 204 });
};
