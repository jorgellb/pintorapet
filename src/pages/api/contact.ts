import type { APIRoute } from 'astro';
import { contactSchema } from '@/lib/validation/checkout';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { parseRequestBody } from '@/lib/server/parseBody';
import { submitContact } from '@/lib/server/commerce/forms';
import { hasResend, hasServiceSupabase } from '@/lib/server/env';

export const prerender = false;

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const raw = await parseRequestBody(request);
    const body = contactSchema.parse(raw);

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
      if (wantsHtml(request)) {
        return new Response(
          `<!doctype html><html><body><p>${payload.message}</p><p><a href="javascript:history.back()">Back</a></p></body></html>`,
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
      return Response.json(payload, { status: 503 });
    }

    const result = await submitContact(body);
    if (wantsHtml(request)) {
      return new Response(
        `<!doctype html><html><body><p>Thank you. Your message was received.</p><p><a href="javascript:history.back()">Back</a></p></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
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
