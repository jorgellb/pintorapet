import type { APIRoute } from 'astro';
import { clientIp, isAntibotForm, issueChallenge } from '@/lib/server/antibot';

export const prerender = false;

/** A fresh challenge for one form. Fetched by the page, never cached. */
export const GET: APIRoute = async (context) => {
  const form = context.url.searchParams.get('form') ?? '';
  if (!isAntibotForm(form)) return Response.json({ error: { code: 'VALIDATION' } }, { status: 400 });
  const challenge = await issueChallenge(form, clientIp(context));
  return Response.json(challenge, {
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
};
