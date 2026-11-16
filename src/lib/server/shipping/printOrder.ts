import type { Db } from '@/lib/server/db';
import type { OrderPaymentStatus } from '@/lib/server/dbTypes';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { loadShippingSettings } from './correos';
import { packingSlipLines, type PrintableAddress, type PrintableOrder, type PrintableSender } from './printables';

/** An order as the label and the packing slip need it (pieces still to send). */
export async function printableOrder(
  client: Db,
  id: string,
): Promise<{ order: PrintableOrder; sender: PrintableSender; brand: string }> {
  const [data, left, settings, shipping] = await Promise.all([
    dbCall(() => client.one<{
      reference: string;
      locale: 'en' | 'es';
      created_at: string;
      payment_status: OrderPaymentStatus;
      shipping_weight_grams: number | null;
      shipping_address: Record<string, string> | null;
      order_items: Array<{ id: string; product_title: string; product_sku: string; quantity: number; created_at: string }>;
    }>`
      select o.reference, o.locale, o.created_at, o.payment_status, o.shipping_weight_grams, o.shipping_address,
             coalesce((select json_agg(json_build_object('id', i.id, 'product_title', i.product_title,
                                                         'product_sku', i.product_sku, 'quantity', i.quantity,
                                                         'created_at', i.created_at))
                       from public.order_items i where i.order_id = o.id), '[]'::json) as order_items
      from public.orders o where o.id = ${id}`),
    client.call('admin_refund_left', { p_order_id: id }).catch(() => null),
    client.one<{ public_name: string | null }>`select public_name from public.shop_settings where id = 1`.catch(() => null),
    loadShippingSettings(),
  ]);
  if (!data) throw new CommerceError('UNAVAILABLE', 'Pedido no encontrado.', 404);
  if (!['paid', 'partially_refunded'].includes(String(data.payment_status))) {
    throw new CommerceError('CONFLICT', 'Solo se imprime para pedidos pagados con piezas por enviar.', 409);
  }
  const items = [...((data.order_items ?? []) as Array<{ id: string; product_title: string; product_sku: string; quantity: number; created_at: string }>)]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((item) => ({ id: item.id, title: item.product_title, sku: item.product_sku, quantity: item.quantity }));
  const address = (data.shipping_address ?? null) as (PrintableAddress & { note?: string }) | null;
  return {
    order: {
      reference: String(data.reference),
      locale: data.locale === 'en' ? 'en' : 'es',
      createdAt: String(data.created_at),
      weightGrams: data.shipping_weight_grams == null ? null : Number(data.shipping_weight_grams),
      note: String(address?.note ?? ''),
      address,
      items: packingSlipLines(items, (left as { items?: Array<{ order_item_id: string; quantity: number }> } | null)?.items ?? null),
    },
    sender: shipping.sender,
    brand: String(settings?.public_name ?? 'Pets Drawings'),
  };
}

export function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(new Blob([bytes as BlobPart], { type: 'application/pdf' }), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
