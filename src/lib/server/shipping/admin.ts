import { db, insertValues, json, sql, type Db } from '@/lib/server/db';
import { CommerceError } from '@/lib/server/commerce/errors';
import { sendOrderEmails } from '@/lib/server/commerce/outbox';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { reviewEligible, reviewUrl } from '@/lib/server/reviews/link';
import {
  cancelShipment,
  clearCorreosConfigCache,
  CorreosApiError,
  deliveryProof,
  loadCorreosConfig,
  loadShippingSettings,
  preregisterShipment,
  searchCitypaqs,
  shipmentLabelPdf,
  testCorreos,
  trackingUrl,
  type CarrierMode,
  type Citypaq,
  type CorreosConfig,
  type ProofKind,
} from './correos';

export type CarrierRow = {
  carrier: 'correos';
  mode: CarrierMode;
  contract_number: string | null;
  client_number: string | null;
  labeller_code: string | null;
  oauth_client_id: string | null;
  gateway_client_id: string | null;
  key_hint: string | null;
  connected_at: string;
};

function hint(value: string): string {
  return value.length <= 12 ? '••••' : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function asCommerce(err: unknown, fallback: string): CommerceError {
  if (err instanceof CommerceError) return err;
  if (err instanceof CorreosApiError) {
    return new CommerceError(err.status === 401 || err.status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE', err.message, err.status >= 500 ? 502 : 400);
  }
  console.error(fallback, err);
  return new CommerceError('INTERNAL', fallback, 500);
}

export async function carrierRow(client: Db): Promise<CarrierRow | null> {
  return dbCall(() => client.one<CarrierRow>`select * from public.shipping_carriers where carrier = 'correos'`);
}

export async function connectCorreos(
  client: Db,
  input: CorreosConfig,
): Promise<CarrierRow | null> {
  try {
    await testCorreos(input);
  } catch (err) {
    throw asCommerce(err, 'No se pudo comprobar la conexión con Correos.');
  }
  const settings = {
      mode: input.mode,
      contractNumber: input.contractNumber,
      clientNumber: input.clientNumber,
      labellerCode: input.labellerCode,
      oauthClientId: input.oauthClientId,
      gatewayClientId: input.gatewayClientId,
      keyHint: hint(input.gatewayClientId),
  };
  const secrets = {
    oauth_client_secret: input.oauthClientSecret,
    gateway_client_secret: input.gatewayClientSecret,
  };
  // Secrets are sealed in the vault: that needs the key for this transaction.
  await dbCall(() => client.withVaultKey(sql`
    select public.admin_connect_carrier(p_carrier => 'correos', p_settings => ${json(settings)}, p_secrets => ${json(secrets)})`));
  clearCorreosConfigCache();
  return carrierRow(client);
}

export async function disconnectCorreos(client: Db): Promise<void> {
  await dbCall(() => client.run`select public.admin_disconnect_carrier(p_carrier => 'correos')`);
  clearCorreosConfigCache();
}

export async function testCorreosConnection(): Promise<void> {
  const cfg = await loadCorreosConfig();
  if (!cfg) throw new CommerceError('NOT_CONFIGURED', 'Correos no está conectado.', 409);
  try {
    await testCorreos(cfg);
  } catch (err) {
    throw asCommerce(err, 'No se pudo comprobar la conexión con Correos.');
  }
}

type OrderForShipment = {
  id: string;
  reference: string;
  locale: 'en' | 'es';
  payment_status: string;
  paid_at: string | null;
  fulfillment_status: string;
  customer_email: string | null;
  customer_name: string | null;
  subtotal_cents: number;
  shipping_address: Record<string, string> | null;
  shipping_country: string | null;
  shipping_weight_grams: number | null;
  shipping_zone_id: string | null;
  carrier: string | null;
  carrier_shipment_code: string | null;
  tracking_code: string | null;
};


async function paidOrder(client: Db, id: string): Promise<OrderForShipment> {
  const order = await dbCall(() => client.one<OrderForShipment>`
    select id, reference, locale, payment_status, paid_at, fulfillment_status, customer_email, customer_name, subtotal_cents,
           shipping_address, shipping_country, shipping_weight_grams, shipping_zone_id, carrier, carrier_shipment_code,
           tracking_code
    from public.orders where id = ${id}`);
  if (!order) throw new CommerceError('UNAVAILABLE', 'Pedido no encontrado.', 404);
  // A partly refunded order still has pieces to send.
  if (order.payment_status !== 'paid' && order.payment_status !== 'partially_refunded') {
    throw new CommerceError('CONFLICT', 'Solo se envían pedidos pagados.', 409);
  }
  return order;
}

export async function createCorreosShipment(client: Db, id: string) {
  const order = await paidOrder(client, id);
  if (order.carrier_shipment_code) {
    throw new CommerceError('CONFLICT', 'Este pedido ya tiene un envío en Correos.', 409);
  }
  const address = order.shipping_address;
  if (!address?.line1 || !address.postal_code || !address.country) {
    throw new CommerceError('VALIDATION', 'El pedido no tiene una dirección de envío completa.', 400);
  }
  const cfg = await loadCorreosConfig();
  if (!cfg) throw new CommerceError('NOT_CONFIGURED', 'Conecta Correos en Envíos para crear envíos.', 409);

  const [zone, items, settings] = await Promise.all([
    order.shipping_zone_id
      ? dbCall(() => client.one<{ correos_product: string | null; customs: boolean; kind: string }>`
          select correos_product, customs, kind from public.shipping_zones where id = ${order.shipping_zone_id}`)
      : Promise.resolve(null),
    dbCall(() => client.rows<{ product_title: string; quantity: number; unit_price_cents: number; weight_grams: number | null }>`
      select i.product_title, i.quantity, i.unit_price_cents, p.weight_grams
      from public.order_items i left join public.products p on p.id = i.product_id
      where i.order_id = ${id}`),
    loadShippingSettings(),
  ]);

  const lines = items.map((item) => ({
    title: String(item.product_title),
    quantity: Number(item.quantity),
    unitPriceCents: Number(item.unit_price_cents),
    weightGrams: Number(item.weight_grams ?? 100),
  }));
  const weight =
    order.shipping_weight_grams ??
    lines.reduce((sum, l) => sum + l.weightGrams * l.quantity, 0) + settings.packagingGrams;
  const international = address.country.toUpperCase() !== 'ES';
  const product = zone?.correos_product || (international ? 'S0107' : 'PAAZE');

  let created: { shipmentCode: string; packageCode: string };
  try {
    created = await preregisterShipment(cfg, settings, {
      reference: order.reference,
      product,
      weightGrams: weight,
      customs: Boolean(zone?.customs) || international,
      valueCents: order.subtotal_cents,
      items: lines,
      addressee: {
        name: address.name || order.customer_name || '',
        line1: address.line1,
        line2: address.line2,
        city: address.city ?? '',
        state: address.state,
        postalCode: address.postal_code,
        country: address.country,
        phone: address.phone,
        email: order.customer_email ?? undefined,
      },
    });
  } catch (err) {
    throw asCommerce(err, 'No se pudo crear el envío en Correos.');
  }

  await dbCall(() => client.run`
    update public.orders
    set carrier = 'correos', carrier_shipment_code = ${created.shipmentCode}, tracking_code = ${created.packageCode},
        label_created_at = now(),
        fulfillment_status = ${order.fulfillment_status === 'unfulfilled' ? 'preparing' : order.fulfillment_status}::public.order_fulfillment_status
    where id = ${id}`);
  return { ...created, product, customs: Boolean(zone?.customs) || international };
}

export async function correosLabel(client: Db, id: string): Promise<{ pdf: Buffer; reference: string }> {
  const order = await paidOrder(client, id);
  if (order.carrier !== 'correos' || !order.carrier_shipment_code) {
    throw new CommerceError('CONFLICT', 'Este pedido no tiene envío en Correos.', 409);
  }
  const cfg = await loadCorreosConfig();
  if (!cfg) throw new CommerceError('NOT_CONFIGURED', 'Correos no está conectado.', 409);
  const customs = (order.shipping_address?.country ?? 'ES').toUpperCase() !== 'ES' || (await zoneNeedsCustoms(client, order.shipping_zone_id));
  try {
    // The label is asked for by package code (tracking_code), not by the expedition's code.
    return { pdf: await shipmentLabelPdf(cfg, order.tracking_code || order.carrier_shipment_code, customs), reference: order.reference };
  } catch (err) {
    throw asCommerce(err, 'No se pudo descargar la etiqueta.');
  }
}

/** The parcel's proof of delivery or signature, also for refunded orders: it is what settles a dispute. */
export async function correosDeliveryProof(client: Db, id: string, kind: ProofKind) {
  const order = await dbCall(() => client.one<{ reference: string; carrier: string | null; tracking_code: string | null }>`
    select reference, carrier, tracking_code from public.orders where id = ${id}`);
  if (!order) throw new CommerceError('UNAVAILABLE', 'Pedido no encontrado.', 404);
  if (order.carrier !== 'correos' || !order.tracking_code) {
    throw new CommerceError('CONFLICT', 'Este pedido no tiene envío en Correos.', 409);
  }
  const cfg = await loadCorreosConfig();
  if (!cfg) throw new CommerceError('NOT_CONFIGURED', 'Correos no está conectado.', 409);
  try {
    return { ...(await deliveryProof(cfg, order.tracking_code, kind)), reference: order.reference };
  } catch (err) {
    throw asCommerce(err, 'No se pudo descargar la prueba de entrega.');
  }
}

/** Public Citypaq lockers for a postal code or a town. */
export async function findCitypaqs(query: string): Promise<Citypaq[]> {
  const cfg = await loadCorreosConfig();
  if (!cfg) throw new CommerceError('NOT_CONFIGURED', 'Conecta Correos para buscar taquillas.', 409);
  try {
    return await searchCitypaqs(cfg, query);
  } catch (err) {
    throw asCommerce(err, 'No se pudieron buscar las taquillas.');
  }
}

async function zoneNeedsCustoms(client: Db, zoneId: string | null): Promise<boolean> {
  if (!zoneId) return false;
  const row = await client.one<{ customs: boolean }>`select customs from public.shipping_zones where id = ${zoneId}`;
  return Boolean(row?.customs);
}

/** Shipping states in which the parcel has left: it can no longer be annulled or sent again. */
export const ON_ITS_WAY = ['shipped', 'in_transit', 'out_for_delivery', 'completed', 'incident', 'returned'];

export async function cancelCorreosShipment(client: Db, id: string): Promise<void> {
  const order = await paidOrder(client, id);
  if (order.carrier !== 'correos' || !order.tracking_code) {
    throw new CommerceError('CONFLICT', 'Este pedido no tiene envío en Correos.', 409);
  }
  if (ON_ITS_WAY.includes(order.fulfillment_status)) {
    throw new CommerceError('CONFLICT', 'El paquete ya salió; la anulación se gestiona con Correos.', 409);
  }
  const cfg = await loadCorreosConfig();
  if (!cfg) throw new CommerceError('NOT_CONFIGURED', 'Correos no está conectado.', 409);
  try {
    await cancelShipment(cfg, order.tracking_code);
  } catch (err) {
    throw asCommerce(err, 'Correos no pudo anular el envío.');
  }
  await dbCall(() => client.run`
    update public.orders set carrier = null, carrier_shipment_code = null, tracking_code = null, label_created_at = null
    where id = ${id}`);
}

/** Saves the tracking number, marks the order shipped and emails the customer once. */
export async function markShipped(
  client: Db,
  id: string,
  input: { carrier: string; trackingCode: string; notify: boolean },
) {
  const order = await paidOrder(client, id);
  await dbCall(() => client.run`
    update public.orders
    set carrier = ${input.carrier}, tracking_code = ${input.trackingCode},
        -- A parcel Correos already moves further keeps its state.
        fulfillment_status = case when fulfillment_status in ('unfulfilled', 'preparing')
                                  then 'shipped'::public.order_fulfillment_status else fulfillment_status end,
        shipped_at = coalesce(shipped_at, now())
    where id = ${id}`);

  if (input.notify && order.customer_email) {
    const service = db();
    // Only while the order can still be reviewed (paid within 120 days). The link must never
    // cost the customer the shipped notice (e.g. no signing secret set): send it without.
    let reviewLink: string | null = null;
    try {
      reviewLink = reviewEligible(order) ? reviewUrl(order) : null;
    } catch (err) {
      console.error('[reviews] no review link in the shipped email', id, err instanceof Error ? err.message : err);
    }
    const payload = {
      order_id: id,
      reference: order.reference,
      carrier: input.carrier,
      tracking_code: input.trackingCode,
      tracking_url: input.carrier === 'correos' ? trackingUrl(input.trackingCode, order.locale) : null,
      review_url: reviewLink,
    };
    await service.run`
      insert into public.notification_outbox ${insertValues({
        dedupe_key: `order_shipped_customer:${id}:${input.trackingCode}`,
        recipient: order.customer_email,
        locale: order.locale,
        template_key: 'order_shipped_customer',
        payload: JSON.stringify(payload),
        status: 'pending',
        next_run_at: new Date().toISOString(),
      })}
      on conflict (dedupe_key) do nothing`;
    await sendOrderEmails(service, id);
  }
}
