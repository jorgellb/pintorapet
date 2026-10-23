import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { adjustProductInventory } from '@/lib/server/admin/products';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

const bodySchema = z
  .object({
    productId: z.string().uuid(),
    stockOnHand: z.number().int().min(0),
    inventoryMode: z.enum(['tracked', 'made_to_order', 'unverified']),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) {
      return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    }
    const body = bodySchema.parse(await request.json());
    const inventory = await adjustProductInventory(admin.client, {
      productId: body.productId,
      stockOnHand: body.stockOnHand,
      inventoryMode: body.inventoryMode,
      adminUserId: admin.user.id,
      note: body.note,
    });
    return Response.json({ ok: true, inventory });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(
        new CommerceError('VALIDATION', 'Invalid inventory payload', 400, err),
      );
    }
    return jsonError(
      new CommerceError('INTERNAL', 'Inventory adjust failed', 500),
    );
  }
};
