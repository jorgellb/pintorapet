import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { adminCreateCustomerSchema, authAdminError, sendPasswordLink } from '@/lib/server/admin/customers';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';
import { createServiceClient } from '@/lib/server/supabase';

export const prerender = false;

/** Create a customer account by hand: confirmed, without a password until they choose one. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  const service = createServiceClient();
  if (!service) return jsonError(new CommerceError('NOT_CONFIGURED', 'Falta la clave de servicio de Supabase.', 503));
  try {
    const body = adminCreateCustomerSchema.parse(await request.json());
    const { data, error } = await service.auth.admin.createUser({
      email: body.email,
      email_confirm: true,
      user_metadata: { full_name: body.full_name },
    });
    if (error || !data.user) throw authAdminError(error?.message);
    const id = data.user.id;
    const { error: profileErr } = await service.from('customers').upsert({
      id,
      full_name: body.full_name,
      phone: body.phone,
      address: body.address,
      billing: body.billing,
    });
    if (profileErr) {
      // Leave nothing half-made.
      await service.auth.admin.deleteUser(id).catch(() => undefined);
      throw new CommerceError('INTERNAL', 'No se pudo guardar la ficha del cliente.', 500);
    }
    const linkSent = body.sendPasswordLink ? await sendPasswordLink(service, body.email) : false;
    await audit(admin, 'create_customer', 'customers', id, { linkSent });
    return Response.json({ ok: true, id, linkSent });
  } catch (err) {
    return failure(err, 'No se pudo crear el cliente.');
  }
};
