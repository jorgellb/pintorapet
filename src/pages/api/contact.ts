import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { contactSchema } from '@/lib/validation/checkout';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { parseRequestBody } from '@/lib/server/parseBody';
import { submitContact } from '@/lib/server/commerce/forms';
import { hasResend, hasServiceSupabase } from '@/lib/server/env';
import { localizedPath, type Locale } from '@/i18n/routes';
import { clientIp, inspect, withoutAntibotFields } from '@/lib/server/antibot';

export const prerender = false;

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

/** Without JavaScript the form posts here; send the visitor back to the page with the outcome. */
function backToForm(request: Request, locale: Locale, params: Record<string, string>): Response {
  const url = new URL(localizedPath(locale, 'contact'), request.url);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.hash = 'form';
  return Response.redirect(url, 303);
}

export const POST: APIRoute = async (context) => {
  const { request } = context;
  try {
    const raw = await parseRequestBody(request);
    const body = contactSchema.parse(withoutAntibotFields(raw));

    const { verdict } = await inspect({
      form: 'contact',
      fields: raw,
      ip: clientIp(context),
      email: body.email,
      name: body.name,
      message: body.message,
    });
    if (verdict === 'rate') {
      if (wantsHtml(request)) return backToForm(request, body.locale, { error: 'rate' });
      return jsonError(new CommerceError('RATE_LIMITED', 'Too many messages', 429));
    }
    if (verdict === 'block') {
      // Bots get the answer a person would get, so they learn nothing.
      const fake = { ok: true, id: randomUUID() };
      if (wantsHtml(request)) return backToForm(request, body.locale, { sent: '1' });
      return Response.json(fake);
    }

    if (!hasServiceSupabase() || !hasResend()) {
      const payload = {
        error: {
          code: 'NOT_CONFIGURED',
          message:
            'Contact form requires SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY.',
        },
        message:
          'Message validated only — persistence/email are not configured.',
      };
      if (wantsHtml(request)) return backToForm(request, body.locale, { error: 'config' });
      return Response.json(payload, { status: 503 });
    }

    const result = await submitContact(body);
    if (wantsHtml(request)) return backToForm(request, body.locale, { sent: '1' });
    return Response.json({ ok: true, id: result.id });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(
        new CommerceError('VALIDATION', 'Invalid contact payload', 400, err),
      );
    }
    return jsonError(new CommerceError('INTERNAL', 'Contact failed', 500));
  }
};
