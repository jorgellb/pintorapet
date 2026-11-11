export type CustomerStatus = {
  key:
    | 'processing'
    | 'review'
    | 'preparing'
    | 'shipped'
    | 'out_for_delivery'
    | 'delivered'
    | 'incident'
    | 'returned'
    | 'refunded'
    | 'cancelled';
  label: string;
  /** Position on the journey: 0 paid, 1 preparing, 2 shipped, 3 delivered. */
  step: number;
};

const LABELS: Record<CustomerStatus['key'], { es: string; en: string }> = {
  processing: { es: 'Confirmando el pago', en: 'Confirming payment' },
  review: { es: 'En revisión', en: 'Being checked' },
  preparing: { es: 'Meili lo está preparando', en: 'Meili is preparing it' },
  shipped: { es: 'En camino', en: 'On its way' },
  out_for_delivery: { es: 'En reparto', en: 'Out for delivery' },
  delivered: { es: 'Entregado', en: 'Delivered' },
  incident: { es: 'Incidencia en la entrega', en: 'Delivery issue' },
  returned: { es: 'Devuelto a Meili', en: 'Returned to Meili' },
  refunded: { es: 'Reembolsado', en: 'Refunded' },
  cancelled: { es: 'Cancelado', en: 'Cancelled' },
};

/** What the customer needs to know, from the payment and fulfilment states. */
export function customerStatus(
  paymentStatus: string,
  fulfillmentStatus: string,
  locale: 'en' | 'es',
): CustomerStatus {
  const make = (key: CustomerStatus['key'], step: number, label = LABELS[key][locale]): CustomerStatus => ({
    key,
    step,
    label,
  });
  if (paymentStatus === 'refunded') return make('refunded', 0);
  if (paymentStatus === 'review') return make('review', 0);
  if (paymentStatus === 'cancelled') return make('cancelled', 0);
  if (paymentStatus === 'expired') return make('cancelled', 0, locale === 'es' ? 'Sin pagar' : 'Not paid');
  // A partly refunded order still has pieces on their way.
  if (paymentStatus !== 'paid' && paymentStatus !== 'partially_refunded') return make('processing', 0);
  switch (fulfillmentStatus) {
    case 'completed':
      return make('delivered', 3);
    case 'shipped':
    case 'in_transit':
      return make('shipped', 2);
    case 'out_for_delivery':
      return make('out_for_delivery', 2);
    case 'incident':
      return make('incident', 2);
    case 'returned':
      return make('returned', 2);
    default:
      return make('preparing', 1);
  }
}
