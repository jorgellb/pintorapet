import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError } from '@/lib/server/commerce/errors';
import { homeSectionsSchema } from '@/lib/content/homeSections';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Save the home page blocks below the hero (Admin › Portada › Bloques). */
export const PUT: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const content = homeSectionsSchema.parse(await request.json());
    const { error } = await admin.client.from('site_home_sections').upsert({
      id: 1,
      content,
      updated_at: new Date().toISOString(),
      updated_by: admin.user.id,
    });
    if (error) throw new CommerceError('INTERNAL', 'No se pudieron guardar los bloques.', 500);
    const hidden = Object.entries(content)
      .filter(([, block]) => !block.visible)
      .map(([name]) => name);
    await audit(admin, 'update_home_sections', 'site_home_sections', '1', { hidden });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudieron guardar los bloques.');
  }
};
