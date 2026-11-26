import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import {
  accountEmail,
  adminCustomerSchema,
  anonymizeAccountOrders,
  assertManageable,
  changeAccountEmail,
  deleteAccount,
  isAdminAccount,
  saveCustomerProfile,
} from '@/lib/server/admin/customers';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';
import { serviceDb } from '@/lib/server/db';

export const prerender = false;

const idSchema = z.uuid();

/** The page's checkbox «Borrar también sus datos de los pedidos» (a delete with no body keeps them). */
const deleteSchema = z.object({ alsoOrders: z.boolean().default(false) }).strict();

/** Edit a customer's email and profile. */
export const PATCH: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  const service = serviceDb();
  if (!service) return jsonError(new CommerceError('NOT_CONFIGURED', 'Falta configurar la base de datos.', 503));
  try {
    const id = idSchema.parse(params.id);
    const body = adminCustomerSchema.parse(await request.json());
    await assertManageable(service, id, admin.user.id);
    const current = await accountEmail(service, id);
    if (current === null) throw new CommerceError('UNAVAILABLE', 'Ese cliente ya no existe.', 404);
    const emailChanged = current.toLowerCase() !== body.email;
    if (emailChanged) await changeAccountEmail(service, id, body.email);
    await saveCustomerProfile(service, id, body);
    await audit(admin, 'update_customer', 'customers', id, { emailChanged });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar el cliente.');
  }
};

/**
 * Delete the account. Orders stay (accounting); they just lose the link to the account.
 * With `alsoOrders`, their personal data goes too (refused first if an order is still due).
 */
export const DELETE: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  const service = serviceDb();
  if (!service) return jsonError(new CommerceError('NOT_CONFIGURED', 'Falta configurar la base de datos.', 503));
  try {
    const id = idSchema.parse(params.id);
    if (id === admin.user.id) {
      throw new CommerceError('FORBIDDEN', 'No puedes borrar tu propia cuenta desde aquí.', 403);
    }
    if (await isAdminAccount(service, id)) throw new CommerceError('FORBIDDEN', 'Es una cuenta de administración: no se borra desde Clientes.', 403);
    const { alsoOrders } = deleteSchema.parse(await request.json().catch(() => ({})));
    if (alsoOrders) {
      const erased = await anonymizeAccountOrders(id);
      await audit(admin, 'delete_customer', 'customers', id, {
        alsoOrders: true,
        orders: erased.orders,
        ...(erased.warning ? { leftovers: true } : {}),
      });
      return Response.json({ ok: true, ...erased });
    }
    await deleteAccount(service, id);
    await audit(admin, 'delete_customer', 'customers', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar el cliente.');
  }
};
