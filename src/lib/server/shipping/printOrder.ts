import type { SupabaseClient } from '@supabase/supabase-js';
import { CommerceError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { loadShippingSettings } from './correos';
import { packingSlipLines, type PrintableAddress, type PrintableOrder, type PrintableSender } from './printables';

/** An order as the label and the packing slip need it (pieces still to send). */
export async function printableOrder(
  client: SupabaseClient,
  id: string,
): Promise<{ order: PrintableOrder; sender: PrintableSender; brand: string }> {
  const [{ data, error }, { data: left }, { data: settings }, shipping] = await Promise.all([
    client
      .from('orders')
      .select('reference, locale, created_at, payment_status, shipping_weight_grams, shipping_address, order_items(id, product_title, product_sku, quantity, created_at)')
      .eq('id', id)
      .maybeSingle(),
    client.rpc('admin_refund_left', { p_order_id: id }),
    client.from('shop_settings').select('public_name').eq('id', 1).maybeSingle(),
    loadShippingSettings(),
  ]);
  if (error) throw mapPgError(error);
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
