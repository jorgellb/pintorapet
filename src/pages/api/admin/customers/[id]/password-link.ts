import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { accountEmail, assertManageable, sendPasswordLink } from '@/lib/server/admin/customers';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';
import { serviceDb } from '@/lib/server/db';

export const prerender = false;

/** Email the customer a link to choose (or reset) their password. */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  const service = serviceDb();
  if (!service) return jsonError(new CommerceError('NOT_CONFIGURED', 'Falta configurar la base de datos.', 503));
  try {
    const id = z.uuid().parse(params.id);
    await assertManageable(service, id, admin.user.id);
    const email = await accountEmail(service, id);
    if (!email) throw new CommerceError('UNAVAILABLE', 'Ese cliente ya no existe.', 404);
    const sent = await sendPasswordLink(email);
    if (!sent) {
      throw new CommerceError('UNAVAILABLE', 'No se pudo enviar el correo. Revisa RESEND_API_KEY y EMAIL_FROM.', 502);
    }
    await audit(admin, 'send_password_link', 'customers', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo enviar el enlace.');
  }
};
