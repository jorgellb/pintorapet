import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { adminCustomerSchema, assertManageable, authAdminError, isAdminAccount } from '@/lib/server/admin/customers';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';
import { createServiceClient } from '@/lib/server/supabase';

export const prerender = false;

const idSchema = z.uuid();

/** Edit a customer's email and profile. */
export const PATCH: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  const service = createServiceClient();
  if (!service) return jsonError(new CommerceError('NOT_CONFIGURED', 'Falta la clave de servicio de Supabase.', 503));
  try {
    const id = idSchema.parse(params.id);
    const body = adminCustomerSchema.parse(await request.json());
    await assertManageable(service, id, admin.user.id);
    const { data: current, error: readErr } = await service.auth.admin.getUserById(id);
    if (readErr || !current.user) throw new CommerceError('UNAVAILABLE', 'Ese cliente ya no existe.', 404);
    const emailChanged = (current.user.email ?? '').toLowerCase() !== body.email;
    if (emailChanged) {
      const { error } = await service.auth.admin.updateUserById(id, { email: body.email, email_confirm: true });
      if (error) throw authAdminError(error.message);
    }
    const { error: profileErr } = await service.from('customers').upsert({
      id,
      full_name: body.full_name,
      phone: body.phone,
      address: body.address,
      billing: body.billing,
    });
    if (profileErr) throw new CommerceError('INTERNAL', 'No se pudo guardar la ficha.', 500);
    await audit(admin, 'update_customer', 'customers', id, { emailChanged });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar el cliente.');
  }
};

/** Delete the account. Orders stay (accounting); they just lose the link to the account. */
export const DELETE: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  const service = createServiceClient();
  if (!service) return jsonError(new CommerceError('NOT_CONFIGURED', 'Falta la clave de servicio de Supabase.', 503));
  try {
    const id = idSchema.parse(params.id);
    if (id === admin.user.id) {
      throw new CommerceError('FORBIDDEN', 'No puedes borrar tu propia cuenta desde aquí.', 403);
    }
    if (await isAdminAccount(service, id)) throw new CommerceError('FORBIDDEN', 'Es una cuenta de administración: no se borra desde Clientes.', 403);
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) throw authAdminError(error.message);
    await audit(admin, 'delete_customer', 'customers', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar el cliente.');
  }
};
