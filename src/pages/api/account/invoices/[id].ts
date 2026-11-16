import type { APIRoute } from 'astro';
import { customerSession } from '@/lib/server/account';
import { customerInvoice, invoicePdfResponse } from '@/lib/server/invoices/serve';
import { serviceDb, userDb } from '@/lib/server/db';

export const prerender = false;

/** A signed-in customer downloads one of their invoices as a PDF. */
export const GET: APIRoute = async ({ params, cookies, request, url }) => {
  const session = await customerSession(cookies, request);
  if (!session) return new Response('Sign in first', { status: 401 });
  const invoice = await customerInvoice(userDb(session.user.id), String(params.id ?? ''));
  if (!invoice) return new Response('Not found', { status: 404 });
  return invoicePdfResponse(
    invoice,
    serviceDb(),
    url.searchParams.get('download') === '1' ? 'attachment' : 'inline',
  );
};
