import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { marketSchema, saveMarket } from '@/lib/server/markets';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Add a market to the calendar, or change one. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const input = marketSchema.parse(await request.json());
    const id = await dbCall(() => saveMarket(admin.db, input));
    await audit(admin, input.id ? 'update_market' : 'create_market', 'markets', id, input);
    return Response.json({ ok: true, id });
  } catch (err) {
    if (err && typeof err === 'object' && 'issues' in err) {
      const issue = (err as { issues: Array<{ message: string; code: string }> }).issues.find((i) => i.code === 'custom');
      if (issue) return Response.json({ error: { code: 'VALIDATION', message: issue.message } }, { status: 400 });
    }
    return failure(err, 'No se pudo guardar el mercado.');
  }
};
