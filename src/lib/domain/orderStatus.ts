export type CustomerStatus = {
  key: 'processing' | 'review' | 'preparing' | 'shipped' | 'delivered' | 'refunded';
  label: string;
  /** Position on the journey: 0 paid, 1 preparing, 2 shipped, 3 delivered. */
  step: number;
};

const LABELS: Record<CustomerStatus['key'], { es: string; en: string }> = {
  processing: { es: 'Confirmando el pago', en: 'Confirming payment' },
  review: { es: 'En revisión', en: 'Being checked' },
  preparing: { es: 'Meili lo está preparando', en: 'Meili is preparing it' },
  shipped: { es: 'En camino', en: 'On its way' },
  delivered: { es: 'Entregado', en: 'Delivered' },
  refunded: { es: 'Reembolsado', en: 'Refunded' },
};

/** What the customer needs to know, from the payment and fulfilment states. */
export function customerStatus(
  paymentStatus: string,
  fulfillmentStatus: string,
  locale: 'en' | 'es',
): CustomerStatus {
  const make = (key: CustomerStatus['key'], step: number): CustomerStatus => ({
    key,
    step,
    label: LABELS[key][locale],
  });
  if (paymentStatus === 'refunded' || paymentStatus === 'partially_refunded') return make('refunded', 0);
  if (paymentStatus === 'review') return make('review', 0);
  if (paymentStatus !== 'paid') return make('processing', 0);
  if (fulfillmentStatus === 'completed') return make('delivered', 3);
  if (fulfillmentStatus === 'shipped') return make('shipped', 2);
  return make('preparing', 1);
}
