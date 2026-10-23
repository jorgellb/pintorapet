import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import {
  cancelCorreosShipment,
  correosLabel,
  createCorreosShipment,
  markShipped,
} from '@/lib/server/shipping/admin';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const trackingSchema = z
  .object({
    carrier: z.string().trim().min(1).max(40),
    trackingCode: z.string().trim().min(4).max(60).regex(/^[A-Za-z0-9-]+$/),
    notify: z.boolean().default(true),
  })
  .strict();

/** Registers the parcel with Correos (label + tracking number). */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    const id = z.uuid().parse(params.id);
    const created = await createCorreosShipment(admin.client, id);
    await audit(admin, 'create_shipment', 'orders', id, created);
    return Response.json({ ok: true, ...created });
  } catch (err) {
    return failure(err, 'No se pudo crear el envío.');
  }
};

/** Manual tracking (any carrier) or "sent" for a Correos parcel; emails the customer. */
export const PUT: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    const id = z.uuid().parse(params.id);
    const body = trackingSchema.parse(await request.json());
    await markShipped(admin.client, id, body);
    await audit(admin, 'mark_order_shipped', 'orders', id, body);
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar el seguimiento.');
  }
};

export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    const id = z.uuid().parse(params.id);
    await cancelCorreosShipment(admin.client, id);
    await audit(admin, 'cancel_shipment', 'orders', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo anular el envío.');
  }
};

/** Label PDF from Correos. */
export const GET: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    const id = z.uuid().parse(params.id);
    const { pdf, reference } = await correosLabel(admin.client, id);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="etiqueta-${reference}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return failure(err, 'No se pudo descargar la etiqueta.');
  }
};
