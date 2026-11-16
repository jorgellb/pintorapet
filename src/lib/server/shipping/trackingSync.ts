import { json, sql, type Db } from '@/lib/server/db';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { CorreosApiError, loadCorreosConfig, trackShipment } from './correos';
import { nextFulfillment, parseCorreosTracking } from './tracking';

export type TrackingSync = { status: string; changed: boolean; summary: string | null; events: number };

type TrackedOrder = { id: string; carrier: string | null; tracking_code: string | null; fulfillment_status: string };

/** Ask Correos about one order's parcel and keep its events; the state only moves forward (or to trouble). */
async function syncOne(client: Db, order: TrackedOrder): Promise<TrackingSync> {
  if (order.carrier !== 'correos' || !order.tracking_code) {
    throw new CommerceError('VALIDATION', 'Este pedido no tiene un envío de Correos con número de seguimiento.', 409);
  }
  const cfg = await loadCorreosConfig();
  if (!cfg) {
    throw new CommerceError('NOT_CONFIGURED', 'Correos no está conectado: el estado se cambia a mano.', 409);
  }
  let payload: unknown;
  try {
    payload = await trackShipment(cfg, order.tracking_code);
  } catch (err) {
    const message = err instanceof CorreosApiError ? err.message : 'Correos no respondió.';
    throw new CommerceError('UNAVAILABLE', message, 502);
  }
  const parsed = parseCorreosTracking(payload);
  const status = nextFulfillment(order.fulfillment_status, parsed.status);
  await dbCall(() => client.run`
    update public.orders
    set tracking_events = ${json(parsed.events)}, tracking_status = ${parsed.summary}, tracking_checked_at = now(),
        fulfillment_status = ${status}::public.fulfillment_status
    where id = ${order.id}`);
  return { status, changed: status !== order.fulfillment_status, summary: parsed.summary, events: parsed.events.length };
}

const COLUMNS = sql`id, carrier, tracking_code, fulfillment_status`;

export async function syncOrderTracking(client: Db, orderId: string): Promise<TrackingSync> {
  const data = await dbCall(() => client.one<TrackedOrder>`select ${COLUMNS} from public.orders where id = ${orderId}`);
  if (!data) throw new CommerceError('UNAVAILABLE', 'Pedido no encontrado.', 404);
  return syncOne(client, data);
}

/** Every Correos parcel still on its way (daily cron). Quiet when Correos is not connected. */
export async function syncOpenShipments(service: Db, limit = 40): Promise<{ checked: number; changed: number }> {
  if (!(await loadCorreosConfig())) return { checked: 0, changed: 0 };
  const data = await service
    .rows<TrackedOrder>`
      select ${COLUMNS} from public.orders
      where carrier = 'correos' and tracking_code is not null
        and fulfillment_status in ('shipped', 'in_transit', 'out_for_delivery', 'incident')
      order by tracking_checked_at asc nulls first
      limit ${limit}`
    .catch(() => []);
  let checked = 0;
  let changed = 0;
  for (const order of data) {
    try {
      const result = await syncOne(service, order);
      checked += 1;
      if (result.changed) changed += 1;
    } catch (err) {
      console.error('tracking sync', order.id, err);
    }
  }
  return { checked, changed };
}
