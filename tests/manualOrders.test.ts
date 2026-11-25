import { describe, expect, it } from 'vitest';
import { fakeDb } from './helpers/fakeDb';
import { createManualOrder, manualOrderSchema, quoteManualOrder } from '../src/lib/server/commerce/manualOrders';
import { CommerceError } from '../src/lib/server/commerce/errors';
import { providerLabel } from '../src/lib/admin/labels';

const MUG = '11111111-1111-4111-8111-111111111111';

const form = {
  lines: [{ productId: MUG, quantity: 2 }],
  country: 'es',
  postalCode: ' 28013 ',
  locale: 'es',
  shipping: '4,90',
  customer: { name: 'Lucía', email: 'Lucia@Example.com', phone: '600 111 222' },
  address: { line1: 'Calle de la Paz 14', city: 'Valencia' },
  paid: false,
};

describe('manualOrderSchema', () => {
  it('reads the form: euros with a comma, a tidy postal code and country', () => {
    const input = manualOrderSchema.parse(form);
    expect(input.shippingCents).toBe(490);
    expect(input.postalCode).toBe('28013');
    expect(input.country).toBe('ES');
  });

  it('leaves the shipping to the zone when it is not typed', () => {
    expect(manualOrderSchema.parse({ ...form, shipping: '' }).shippingCents).toBeNull();
  });

  it('refuses an order with no pieces or silly quantities', () => {
    expect(() => manualOrderSchema.parse({ ...form, lines: [] })).toThrow();
    expect(() => manualOrderSchema.parse({ ...form, lines: [{ productId: MUG, quantity: 0 }] })).toThrow();
  });
});

describe('createManualOrder', () => {
  it('sends the database what it expects', async () => {
    const { db, call } = fakeDb({ answer: () => ({ data: { order_id: 'o1', reference: 'PD-1', total_cents: 2488 } }) });
    const out = await createManualOrder(db, manualOrderSchema.parse(form));
    expect(out).toEqual({ orderId: 'o1', reference: 'PD-1' });
    const [name, args] = call.mock.calls[0];
    expect(name).toBe('admin_create_manual_order');
    const p = (args as { p: Record<string, unknown> }).p;
    expect(p).toMatchObject({
      lines: [{ product_id: MUG, quantity: 2 }],
      country: 'ES',
      postal_code: '28013',
      shipping_cents: 490,
      customer: { name: 'Lucía', email: 'Lucia@Example.com', phone: '600 111 222' },
      address: { line1: 'Calle de la Paz 14', city: 'Valencia' },
      paid: false,
    });
  });

  it('explains in Spanish what is missing', async () => {
    const { db } = fakeDb({ answer: () => ({ error: { message: 'INSUFFICIENT_STOCK: PD-2051' } }) });
    const error = (await createManualOrder(db, manualOrderSchema.parse(form)).catch((err: unknown) => err)) as CommerceError;
    expect(error).toBeInstanceOf(CommerceError);
    expect(error.message).toBe('No hay stock suficiente de PD-2051.');
  });

  it('says when there is no shipping to that address', async () => {
    const { db } = fakeDb({ answer: () => ({ error: { message: 'SHIPPING_NO_ZONE' } }) });
    const error = (await quoteManualOrder(db, manualOrderSchema.parse({ ...form, shipping: '' })).catch((err: unknown) => err)) as CommerceError;
    expect(error.message).toMatch(/no se envía/i);
  });
});

describe('providerLabel', () => {
  it('names how an order was paid', () => {
    expect(providerLabel('stripe')).toBe('Stripe');
    expect(providerLabel('paypal')).toBe('PayPal');
    expect(providerLabel('transfer')).toBe('Transferencia');
    expect(providerLabel(null)).toBe('—');
  });
});
