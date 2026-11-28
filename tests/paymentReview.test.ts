import { describe, expect, it } from 'vitest';
import { reviewConfirmable, reviewReasonText } from '../src/lib/domain/paymentReview';
import { renderTemplate } from '../src/lib/server/commerce/outbox';

describe('payments under review', () => {
  it('says why in plain words, with a fallback for orders reviewed before reasons were kept', () => {
    expect(reviewReasonText('AMOUNT_MISMATCH')).toMatch(/importe distinto/);
    expect(reviewReasonText('DESTINATION_CHANGED')).toMatch(/Canarias/);
    expect(reviewReasonText(null)).toMatch(/revisarlo/);
    expect(reviewReasonText('SOMETHING_NEW')).toMatch(/revisarlo/);
  });

  it('only a payment that matches its order can be taken as good (as in payment_review_confirmable)', () => {
    for (const reason of ['PAID_WITHOUT_RESERVATION', 'STOCK_CONSUME_FAILED', 'DESTINATION_CHANGED', 'COMMISSION_QUOTE_CHANGED', 'PAID_AFTER_CANCEL']) {
      expect(reviewConfirmable(reason)).toBe(true);
    }
    // A reason not known (an order reviewed before reasons were kept) is refunded, never confirmed.
    for (const reason of ['AMOUNT_MISMATCH', 'COMMISSION_ALREADY_PAID', 'PAID_AGAIN', null, 'SOMETHING_NEW']) {
      expect(reviewConfirmable(reason)).toBe(false);
    }
  });

  it('tells Meili which extra payment to refund, and not to refund the order', () => {
    const mail = renderTemplate('payment_review_admin', 'es', {
      order_id: '11111111-1111-4111-8111-111111111111',
      reference: 'PD-ABC',
      reason: 'PAID_AGAIN',
      payment: 'pi_123',
    });
    expect(mail.subject).toBe('Pago de más en PD-ABC');
    expect(mail.text).toMatch(/pi_123/);
    expect(mail.text).toMatch(/no uses «Devolver»/);
  });

  it('emails Meili the reason and a link to the order', () => {
    const mail = renderTemplate('payment_review_admin', 'es', {
      order_id: '11111111-1111-4111-8111-111111111111',
      reference: 'PD-ABC',
      reason: 'AMOUNT_MISMATCH',
    });
    expect(mail.subject).toBe('Pago a revisar: PD-ABC');
    expect(mail.text).toMatch(/importe distinto/);
    expect(mail.text).toMatch(/\/admin\/orders\/11111111-1111-4111-8111-111111111111\//);
  });
});
