import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { testProvider } from '@/lib/server/payments/connect';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
  const provider = params.provider;
  if (provider !== 'stripe' && provider !== 'paypal') {
    return jsonError(new CommerceError('VALIDATION', 'Método de pago desconocido', 404));
  }
  return Response.json(await testProvider(provider));
};
