import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { commissionConfigSchema, saveCommissionConfig } from '@/lib/server/commissionQuotes';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Commission settings: VAT, packed weights, bank account for transfers, how long a quote lasts. */
export const PUT: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const config = commissionConfigSchema.parse(await request.json());
    await saveCommissionConfig(admin.db, config);
    await audit(admin, 'update_commission_config', 'shop_settings', '1', { vatRate: config.vatRate, weights: config.weights });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudieron guardar los ajustes de encargos.');
  }
};
