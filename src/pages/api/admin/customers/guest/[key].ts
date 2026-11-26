import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { adminGuestSchema, anonymizeGuest, GUEST_KEY, updateGuest } from '@/lib/server/admin/customers';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';
import { serviceDb } from '@/lib/server/db';

export const prerender = false;

const keySchema = z.string().regex(GUEST_KEY);

/**
 * The audit line names no one: not an email or a name, and not the key either (a
 * stable hash of an erased person's email must not outlive the erasure). Counts only.
 */
const ENTITY = 'guest';

/** Edit a guest's name, email and phone on all their orders. */
export const PATCH: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  const service = serviceDb();
  if (!service) return jsonError(new CommerceError('NOT_CONFIGURED', 'Falta configurar la base de datos.', 503));
  try {
    const key = keySchema.parse(params.key);
    const body = adminGuestSchema.parse(await request.json().catch(() => null));
    const saved = await updateGuest(service, key, body);
    await audit(admin, 'update_guest_customer', 'guest_customers', ENTITY, { orders: saved.orders, merged: saved.merged });
    return Response.json({ ok: true, ...saved });
  } catch (err) {
    // Joining two guests is asked first: the page confirms and sends it again.
    if (err instanceof CommerceError && (err.details as { merge?: boolean } | undefined)?.merge) {
      return Response.json({ error: { code: err.code, message: err.message }, merge: true }, { status: err.status });
    }
    return failure(err, 'No se pudo guardar el cliente.');
  }
};

/** Anonymize the guest's data (orders and invoices stay). Refused while an order is still due. */
export const DELETE: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  const service = serviceDb();
  if (!service) return jsonError(new CommerceError('NOT_CONFIGURED', 'Falta configurar la base de datos.', 503));
  try {
    const key = keySchema.parse(params.key);
    const done = await anonymizeGuest(service, key);
    await audit(admin, 'erase_guest_customer', 'guest_customers', ENTITY, {
      orders: done.orders,
      ...(done.warning ? { leftovers: true } : {}),
    });
    return Response.json({ ok: true, ...done });
  } catch (err) {
    return failure(err, 'No se pudieron borrar los datos del cliente.');
  }
};
