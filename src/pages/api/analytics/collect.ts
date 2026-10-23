import type { APIRoute } from 'astro';
import { recordVisit } from '@/lib/analytics/record';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    await recordVisit(request, body);
  } catch {
    // A missed page view should never surface as an error to the visitor.
  }
  return new Response(null, { status: 204 });
};
