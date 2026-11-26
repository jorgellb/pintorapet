import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { deleteMarket } from '@/lib/server/markets';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Take a market off the calendar (its sales stay, without the market). */
export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    await dbCall(() => deleteMarket(admin.db, id));
    await audit(admin, 'delete_market', 'markets', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar el mercado.');
  }
};
