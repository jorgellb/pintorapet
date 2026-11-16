import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { adminCreateCustomerSchema, createAccount, deleteAccount, saveCustomerProfile, sendPasswordLink } from '@/lib/server/admin/customers';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';
import { serviceDb } from '@/lib/server/db';

export const prerender = false;

/** Create a customer account by hand: confirmed, without a password until they choose one. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  const service = serviceDb();
  if (!service) return jsonError(new CommerceError('NOT_CONFIGURED', 'Falta configurar la base de datos.', 503));
  try {
    const body = adminCreateCustomerSchema.parse(await request.json());
    const id = await createAccount(service, body.email, body.full_name);
    try {
      await saveCustomerProfile(service, id, body);
    } catch (err) {
      // Leave nothing half-made.
      await deleteAccount(service, id).catch(() => undefined);
      throw err;
    }
    const linkSent = body.sendPasswordLink ? await sendPasswordLink(body.email) : false;
    await audit(admin, 'create_customer', 'customers', id, { linkSent });
    return Response.json({ ok: true, id, linkSent });
  } catch (err) {
    return failure(err, 'No se pudo crear el cliente.');
  }
};
