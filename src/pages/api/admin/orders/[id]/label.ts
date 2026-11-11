import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { pdfResponse, printableOrder } from '@/lib/server/shipping/printOrder';
import { renderAddressLabel } from '@/lib/server/shipping/printables';
import { failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** A6 address label to stick on the parcel (no Correos account needed). */
export const GET: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const { order, sender, brand } = await printableOrder(admin.client, z.uuid().parse(params.id));
    return pdfResponse(await renderAddressLabel(order, sender, brand), `etiqueta-${order.reference}.pdf`);
  } catch (err) {
    return failure(err, 'No se pudo preparar la etiqueta.');
  }
};
