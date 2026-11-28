/**
 * Why a payment is waiting for Meili (orders.review_reason, set by
 * apply_payment), in her words, and what she can do about it.
 */
export type ReviewReason =
  | 'AMOUNT_MISMATCH'
  | 'STOCK_CONSUME_FAILED'
  | 'PAID_WITHOUT_RESERVATION'
  | 'DESTINATION_CHANGED'
  | 'COMMISSION_ALREADY_PAID'
  | 'COMMISSION_QUOTE_CHANGED'
  | 'PAID_AFTER_CANCEL'
  | 'PAID_AGAIN';

const TEXT: Record<ReviewReason, string> = {
  AMOUNT_MISMATCH: 'Se ha cobrado un importe distinto del total del pedido.',
  STOCK_CONSUME_FAILED: 'Al llegar el pago no se pudo apartar alguna pieza del stock.',
  PAID_WITHOUT_RESERVATION: 'El pago llegó cuando la reserva de las piezas ya había caducado.',
  DESTINATION_CHANGED:
    'La dirección de entrega está en otra zona que la del presupuesto (por ejemplo, Canarias y la Península): el IVA o el envío pueden no cuadrar.',
  COMMISSION_ALREADY_PAID: 'Este encargo ya estaba pagado con otro pedido.',
  COMMISSION_QUOTE_CHANGED: 'El presupuesto del encargo cambió después de abrir este pago.',
  PAID_AFTER_CANCEL: 'El pago llegó después de cancelar el pedido.',
  PAID_AGAIN: 'Ha llegado un segundo pago para un pedido que ya estaba pagado o devuelto.',
};

/** The money matches the order: it can be confirmed. Otherwise it is refunded. */
const CONFIRMABLE = new Set<string>([
  'PAID_WITHOUT_RESERVATION',
  'STOCK_CONSUME_FAILED',
  'DESTINATION_CHANGED',
  'COMMISSION_QUOTE_CHANGED',
  'PAID_AFTER_CANCEL',
]);

export function reviewReasonText(reason: string | null | undefined): string {
  return (reason && TEXT[reason as ReviewReason]) || 'El pago no encaja con el pedido y hay que revisarlo.';
}

/** Same rule as public.payment_review_confirmable: a reason not known is refunded, never confirmed. */
export function reviewConfirmable(reason: string | null | undefined): boolean {
  return Boolean(reason) && CONFIRMABLE.has(reason!);
}
