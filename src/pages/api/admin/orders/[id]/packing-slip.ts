import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { pdfResponse, printableOrder } from '@/lib/server/shipping/printOrder';
import { renderPackingSlip } from '@/lib/server/shipping/printables';
import { failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** A4 packing slip for inside the parcel: the pieces still to send, no prices. */
export const GET: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const { order, brand } = await printableOrder(admin.client, z.uuid().parse(params.id));
    return pdfResponse(await renderPackingSlip(order, brand), `albaran-${order.reference}.pdf`);
  } catch (err) {
    return failure(err, 'No se pudo preparar el albarán.');
  }
};
