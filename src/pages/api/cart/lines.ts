import type { APIRoute } from 'astro';
import { z } from 'zod';
import { loadPublicCatalog } from '@/lib/catalog/loadProducts';
import { productPath } from '@/i18n/routes';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

const bodySchema = z.object({
  locale: z.enum(['es', 'en']),
  ids: z.array(z.uuid()).max(20),
});

/** Display data for cart lines. Read-only: prices are recomputed at checkout. */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { locale, ids } = bodySchema.parse(await request.json());
    const { products } = await loadPublicCatalog(locale);
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = ids.flatMap((id) => {
      const product = byId.get(id);
      if (!product) return [];
      const parent = product.parentId ? byId.get(product.parentId) : undefined;
      return [
        {
          productId: product.id,
          title: parent?.title ?? product.title,
          variantLabel: parent ? (product.variantLabel ?? product.title) : null,
          href: productPath(locale, product.slug),
          imageUrl: product.coverImageUrl ?? parent?.coverImageUrl ?? null,
          unitAmountCents: product.priceCents,
          purchasable: product.saleEnabled && product.availability === 'available',
          availability: product.availability,
        },
      ];
    });
    return Response.json({ lines }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(new CommerceError('VALIDATION', 'Invalid cart', 400));
    }
    return jsonError(new CommerceError('INTERNAL', 'Cart lines failed', 500));
  }
};
