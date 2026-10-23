import type { SupabaseClient } from '@supabase/supabase-js';
import { CommerceError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { createServiceClient } from '@/lib/server/supabase';
import {
  cancelShipment,
  clearCorreosConfigCache,
  CorreosApiError,
  loadCorreosConfig,
  loadShippingSettings,
  preregisterShipment,
  shipmentLabelPdf,
  testCorreos,
  trackingUrl,
  type CarrierMode,
  type CorreosConfig,
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

export async function carrierRow(client: SupabaseClient): Promise<CarrierRow | null> {
  const { data, error } = await client.from('shipping_carriers').select('*').eq('carrier', 'correos').maybeSingle();
  if (error) throw mapPgError(error);
  return (data as CarrierRow | null) ?? null;
}

export async function connectCorreos(
  client: SupabaseClient,
  input: CorreosConfig,
): Promise<CarrierRow | null> {
  try {
    await testCorreos(input);
  } catch (err) {
    throw asCommerce(err, 'No se pudo comprobar la conexión con Correos.');
  }
  const { error } = await client.rpc('admin_connect_carrier', {
    p_carrier: 'correos',
    p_settings: {
      mode: input.mode,
      contractNumber: input.contractNumber,
      clientNumber: input.clientNumber,
      labellerCode: input.labellerCode,
      oauthClientId: input.oauthClientId,
      gatewayClientId: input.gatewayClientId,
      keyHint: hint(input.gatewayClientId),
    },
    p_secrets: {
      oauth_client_secret: input.oauthClientSecret,
      gateway_client_secret: input.gatewayClientSecret,
    },
  });
  if (error) throw mapPgError(error);
  clearCorreosConfigCache();
  return carrierRow(client);
}

export async function disconnectCorreos(client: SupabaseClient): Promise<void> {
  const { error } = await client.rpc('admin_disconnect_carrier', { p_carrier: 'correos' });
  if (error) throw mapPgError(error);
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

const ORDER_COLUMNS =
  'id, reference, locale, payment_status, fulfillment_status, customer_email, customer_name, subtotal_cents, shipping_address, shipping_country, shipping_weight_grams, shipping_zone_id, carrier, carrier_shipment_code, tracking_code';

async function paidOrder(client: SupabaseClient, id: string): Promise<OrderForShipment> {
  const { data, error } = await client.from('orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw mapPgError(error);
  if (!data) throw new CommerceError('UNAVAILABLE', 'Pedido no encontrado.', 404);
  const order = data as OrderForShipment;
  if (order.payment_status !== 'paid') {
    throw new CommerceError('CONFLICT', 'Solo se envían pedidos pagados.', 409);
  }
  return order;
}

export async function createCorreosShipment(client: SupabaseClient, id: string) {
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

  const [{ data: zone }, { data: items }, settings] = await Promise.all([
    order.shipping_zone_id
      ? client.from('shipping_zones').select('correos_product, customs, kind').eq('id', order.shipping_zone_id).maybeSingle()
      : Promise.resolve({ data: null }),
    client.from('order_items').select('product_title, quantity, unit_price_cents, products(weight_grams)').eq('order_id', id),
    loadShippingSettings(),
  ]);

  const lines = (items ?? []).map((item) => {
    const product = item.products as { weight_grams?: number } | { weight_grams?: number }[] | null;
    const weight = Array.isArray(product) ? product[0]?.weight_grams : product?.weight_grams;
    return {
      title: String(item.product_title),
      quantity: Number(item.quantity),
      unitPriceCents: Number(item.unit_price_cents),
      weightGrams: Number(weight ?? 100),
    };
  });
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

  const { error } = await client
    .from('orders')
    .update({
      carrier: 'correos',
      carrier_shipment_code: created.shipmentCode,
      tracking_code: created.packageCode,
      label_created_at: new Date().toISOString(),
      fulfillment_status: order.fulfillment_status === 'unfulfilled' ? 'preparing' : order.fulfillment_status,
    })
    .eq('id', id);
  if (error) throw mapPgError(error);
  return { ...created, product, customs: Boolean(zone?.customs) || international };
}

export async function correosLabel(client: SupabaseClient, id: string): Promise<{ pdf: Buffer; reference: string }> {
  const order = await paidOrder(client, id);
  if (order.carrier !== 'correos' || !order.carrier_shipment_code) {
    throw new CommerceError('CONFLICT', 'Este pedido no tiene envío en Correos.', 409);
  }
  const cfg = await loadCorreosConfig();
  if (!cfg) throw new CommerceError('NOT_CONFIGURED', 'Correos no está conectado.', 409);
  const customs = (order.shipping_address?.country ?? 'ES').toUpperCase() !== 'ES' || (await zoneNeedsCustoms(client, order.shipping_zone_id));
  try {
    return { pdf: await shipmentLabelPdf(cfg, order.carrier_shipment_code, customs), reference: order.reference };
  } catch (err) {
    throw asCommerce(err, 'No se pudo descargar la etiqueta.');
  }
}

async function zoneNeedsCustoms(client: SupabaseClient, zoneId: string | null): Promise<boolean> {
  if (!zoneId) return false;
  const { data } = await client.from('shipping_zones').select('customs').eq('id', zoneId).maybeSingle();
  return Boolean(data?.customs);
}

export async function cancelCorreosShipment(client: SupabaseClient, id: string): Promise<void> {
  const order = await paidOrder(client, id);
  if (order.carrier !== 'correos' || !order.tracking_code) {
    throw new CommerceError('CONFLICT', 'Este pedido no tiene envío en Correos.', 409);
  }
  if (order.fulfillment_status === 'shipped' || order.fulfillment_status === 'completed') {
    throw new CommerceError('CONFLICT', 'El paquete ya salió; la anulación se gestiona con Correos.', 409);
  }
  const cfg = await loadCorreosConfig();
  if (!cfg) throw new CommerceError('NOT_CONFIGURED', 'Correos no está conectado.', 409);
  try {
    await cancelShipment(cfg, order.tracking_code);
  } catch (err) {
    throw asCommerce(err, 'Correos no pudo anular el envío.');
  }
  const { error } = await client
    .from('orders')
    .update({ carrier: null, carrier_shipment_code: null, tracking_code: null, label_created_at: null })
    .eq('id', id);
  if (error) throw mapPgError(error);
}

/** Saves the tracking number, marks the order shipped and emails the customer once. */
export async function markShipped(
  client: SupabaseClient,
  id: string,
  input: { carrier: string; trackingCode: string; notify: boolean },
) {
  const order = await paidOrder(client, id);
  const { error } = await client
    .from('orders')
    .update({
      carrier: input.carrier,
      tracking_code: input.trackingCode,
      fulfillment_status: 'shipped',
      shipped_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw mapPgError(error);

  if (input.notify && order.customer_email) {
    const service = createServiceClient();
    await service?.from('notification_outbox').upsert(
      {
        dedupe_key: `order_shipped_customer:${id}:${input.trackingCode}`,
        recipient: order.customer_email,
        locale: order.locale,
        template_key: 'order_shipped_customer',
        payload: {
          order_id: id,
          reference: order.reference,
          carrier: input.carrier,
          tracking_code: input.trackingCode,
          tracking_url: input.carrier === 'correos' ? trackingUrl(input.trackingCode, order.locale) : null,
        },
        status: 'pending',
        next_run_at: new Date().toISOString(),
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    );
  }
}
