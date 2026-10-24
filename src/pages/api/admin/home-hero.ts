import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError } from '@/lib/server/commerce/errors';
import { heroContentSchema } from '@/lib/content/homeHero';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Save the home page hero (Admin › Portada). */
export const PUT: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const content = heroContentSchema.parse(await request.json());
    const { error } = await admin.client.from('site_home_hero').upsert({
      id: 1,
      content,
      updated_at: new Date().toISOString(),
      updated_by: admin.user.id,
    });
    if (error) throw new CommerceError('INTERNAL', 'No se pudo guardar la portada.', 500);
    await audit(admin, 'update_home_hero', 'site_home_hero', '1', { design: content.design });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar la portada.');
  }
};
