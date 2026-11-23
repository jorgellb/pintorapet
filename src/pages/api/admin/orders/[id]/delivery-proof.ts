import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { correosDeliveryProof } from '@/lib/server/shipping/admin';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const kindSchema = z.enum(['pee', 'pod']);

/** The parcel's electronic proof of delivery (pee, PDF) or signature (pod, image), from Correos. */
export const GET: APIRoute = async ({ params, request, cookies, url }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const kind = kindSchema.parse(url.searchParams.get('tipo'));
    const proof = await correosDeliveryProof(admin.db, id, kind);
    await audit(admin, 'download_delivery_proof', 'orders', id, { kind });
    const name = `${kind === 'pee' ? 'prueba-entrega' : 'firma'}-${proof.reference}.${proof.extension}`;
    return new Response(new Uint8Array(proof.bytes), {
      headers: {
        'Content-Type': proof.contentType,
        'Content-Disposition': `attachment; filename="${name}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return failure(err, 'No se pudo descargar la prueba de entrega.');
  }
};
