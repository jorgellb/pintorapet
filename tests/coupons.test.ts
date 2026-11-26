import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb';
import { claimCoupon, ownEmail, releaseOwnerCouponOrders, stripeSessionExpiry } from '../src/lib/server/commerce/checkout';
import { createPersistedQuote, quoteCouponCtx } from '../src/lib/server/commerce/quotes';
import {
  couponMessage,
  couponSchema,
  couponSummary,
  formatCouponPercent,
  normalizeCouponCode,
  type Coupon,
} from '../src/lib/domain/coupons';
import { mapPgError } from '../src/lib/server/commerce/pgErrors';
import { quotePublicPayload, type PersistedQuote } from '../src/lib/server/commerce/quotes';
import { quoteRequestSchema } from '../src/lib/validation/checkout';

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'c1',
  code: 'NAVIDAD10',
  note: '',
  status: 'active',
  kind: 'percent',
  percent: 10,
  amountCents: null,
  capCents: null,
  buyQty: null,
  getQty: null,
  nth: null,
  categoryIds: [],
  collectionIds: [],
  productIds: [],
  excludedProductIds: [],
  minSubtotalCents: null,
  minUnits: null,
  zoneIds: [],
  allowShipping: true,
  allowPickup: true,
  firstOrderOnly: false,
  requireAccount: false,
  emails: [],
  emailsRequireAccount: false,
  startsAt: null,
  endsAt: null,
  weekdays: [],
  maxUses: null,
  maxUsesPerCustomer: null,
  announce: false,
  version: 1,
  ...over,
});

const names = {
  categories: new Map([
    ['cat-tazas', 'Tazas'],
    ['cat-posavasos', 'Posavasos'],
  ]),
  collections: new Map<string, string>(),
  products: new Map<string, string>(),
  zones: new Map<string, string>(),
};

const base = { code: 'NAVIDAD10', kind: 'percent', percent: 10 } as const;

describe('normalizeCouponCode', () => {
  it('trims, upper-cases and strips inner spaces', () => {
    expect(normalizeCouponCode(' navidad 10 ')).toBe('NAVIDAD10');
  });
});

describe('formatCouponPercent', () => {
  it('writes the percent in the customer\'s language', () => {
    expect(formatCouponPercent(12.5, 'es')).toBe('12,5 %');
    expect(formatCouponPercent(12.5, 'en')).toBe('12.5%');
    expect(formatCouponPercent(10, 'es')).toBe('10 %');
    expect(formatCouponPercent(10, 'en')).toBe('10%');
    expect(formatCouponPercent(33.33, 'es')).toBe('33,33 %');
  });
});

describe('couponMessage', () => {
  it('says how much is missing for the minimum purchase', () => {
    expect(couponMessage('COUPON_MIN_SUBTOTAL', 'es', { missingCents: 2001 })).toContain('20,01');
    expect(couponMessage('COUPON_MIN_SUBTOTAL', 'en', { missingCents: 2001 })).toContain('20.01');
  });

  it('gives the same answer for a code that does not exist in both languages', () => {
    expect(couponMessage('COUPON_NOT_FOUND', 'es')).toBe('Este código no existe o ya no está activo.');
    expect(couponMessage('COUPON_NOT_FOUND', 'en')).toMatch(/does not exist/);
  });

  it('has a text for every reason', () => {
    const reasons = [
      'COUPON_NOT_FOUND', 'COUPON_NOT_STARTED', 'COUPON_EXPIRED', 'COUPON_WRONG_DAY', 'COUPON_NO_ITEMS',
      'COUPON_MIN_SUBTOTAL', 'COUPON_MIN_UNITS', 'COUPON_ZONE', 'COUPON_PICKUP', 'COUPON_SHIPPING',
      'COUPON_FIRST_ORDER', 'COUPON_ACCOUNT', 'COUPON_EMAIL', 'COUPON_USED', 'COUPON_SOLD_OUT', 'COUPON_CHANGED',
    ] as const;
    for (const reason of reasons) {
      for (const locale of ['es', 'en'] as const) {
        expect(couponMessage(reason, locale, { missingCents: 100, missingUnits: 1 }).length).toBeGreaterThan(10);
      }
    }
  });
});

describe('couponSummary', () => {
  it('reads a percent coupon with its dates and limits', () => {
    const c = coupon({
      categoryIds: ['cat-tazas', 'cat-posavasos'],
      // Madrid midnight: 1 Dec 00:00 to 25 Dec 00:00 (the 24th is the last day).
      startsAt: '2026-11-30T23:00:00Z',
      endsAt: '2026-12-24T23:00:00Z',
      maxUsesPerCustomer: 1,
      maxUses: 100,
    });
    expect(couponSummary(c, names)).toBe('−10 % en Tazas y Posavasos · del 1 al 24 dic · 1 uso por cliente · máx. 100 usos');
  });

  it('writes a percent with decimals as Spanish does', () => {
    expect(couponSummary(coupon({ percent: 12.5 }), names)).toBe('−12,5 % en toda la tienda');
    expect(couponSummary(coupon({ kind: 'nth_unit', percent: 12.5, nth: 3 }), names)).toBe('La 3.ª unidad con −12,5 % en toda la tienda');
  });

  it('reads the other kinds', () => {
    expect(couponSummary(coupon({ kind: 'fixed', percent: null, amountCents: 500 }), names)).toBe('−5,00\u00a0€ en toda la tienda');
    expect(couponSummary(coupon({ kind: 'free_shipping', percent: null }), names)).toBe('Envío gratis');
    expect(couponSummary(coupon({ kind: 'buy_x_get_y', percent: null, buyQty: 2, getQty: 1 }), names)).toBe(
      'Compra 2 y llévate 1 gratis en toda la tienda',
    );
    expect(couponSummary(coupon({ kind: 'nth_unit', percent: 50, nth: 2 }), names)).toBe(
      'La 2.ª unidad con −50 % en toda la tienda',
    );
  });
});

describe('couponSchema', () => {
  it('accepts a percent coupon and tidies it', () => {
    const parsed = couponSchema.parse({ ...base, code: ' navidad 10 ', emails: [' Ana@Example.com '] });
    expect(parsed.code).toBe('NAVIDAD10');
    expect(parsed.emails).toEqual(['ana@example.com']);
    expect(parsed.status).toBe('active');
  });

  it('rejects what the table would', () => {
    const bad = (over: Record<string, unknown>, from: Record<string, unknown> = base) =>
      couponSchema.safeParse({ ...from, ...over }).success;
    expect(bad({ percent: undefined })).toBe(false);
    expect(bad({ percent: 120 })).toBe(false);
    expect(bad({ percent: 0 })).toBe(false);
    expect(bad({ kind: 'nth_unit', nth: 1, percent: 50 })).toBe(false);
    expect(bad({ kind: 'nth_unit', nth: 2, percent: 50 })).toBe(true);
    expect(bad({ kind: 'nth_unit', percent: 50 })).toBe(false);
    expect(bad({ kind: 'fixed', percent: undefined })).toBe(false);
    expect(bad({ kind: 'fixed', percent: undefined, amountCents: 500 })).toBe(true);
    expect(bad({ kind: 'buy_x_get_y', percent: undefined, buyQty: 2 })).toBe(false);
    expect(bad({ kind: 'buy_x_get_y', percent: undefined, buyQty: 2, getQty: 1 })).toBe(true);
    expect(bad({ kind: 'free_shipping', percent: undefined })).toBe(true);
    expect(bad({ code: 'A B' })).toBe(false); // 'AB' once the space is gone: too short
    expect(bad({ code: 'AB C' })).toBe(true);
    expect(bad({ code: 'A!B' })).toBe(false);
    expect(bad({ code: 'AB' })).toBe(false);
    expect(bad({ weekdays: [0] })).toBe(false);
    expect(bad({ weekdays: [1, 7] })).toBe(true);
    expect(bad({ emails: ['no-es-un-email'] })).toBe(false);
    expect(bad({ unknownKey: 1 })).toBe(false);
  });

  it('rejects an end before the start', () => {
    const result = couponSchema.safeParse({ ...base, startsAt: '2026-12-10T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' });
    expect(result.success).toBe(false);
    expect(couponSchema.safeParse({ ...base, startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-10T00:00:00Z' }).success).toBe(true);
  });

  it('ignores a value its kind does not use before judging it, so a leftover never blocks a save', () => {
    const parsed = couponSchema.safeParse({ ...base, kind: 'fixed', amountCents: 500, percent: 250, nth: 1, buyQty: 0, getQty: 'x' });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ percent: null, nth: null, buyQty: null, getQty: null, amountCents: 500 });
    // The values the kind uses are still judged.
    expect(couponSchema.safeParse({ ...base, percent: 250 }).success).toBe(false);
    expect(couponSchema.safeParse({ ...base, kind: 'nth_unit', nth: 2, percent: 250 }).success).toBe(false);
  });

  it('keeps only the values its kind uses', () => {
    const parsed = couponSchema.parse({ ...base, kind: 'fixed', amountCents: 500, percent: 10, capCents: 100 });
    expect(parsed.percent).toBeNull();
    expect(parsed.capCents).toBeNull();
    expect(parsed.amountCents).toBe(500);
  });
});

describe('quote request', () => {
  const item = { productId: '00000000-0000-4000-8000-000000000001', quantity: 1 };

  it('takes a code and an email', () => {
    const body = quoteRequestSchema.parse({ locale: 'es', items: [item], couponCode: ' navidad10 ', email: 'a@b.es' });
    expect(body.couponCode).toBe('navidad10');
    expect(body.email).toBe('a@b.es');
  });

  it('does not take a pickup flag or customer id from the browser', () => {
    expect(quoteRequestSchema.safeParse({ locale: 'es', items: [item], couponCtx: { pickup: true } }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ locale: 'es', items: [item], customerId: 'x' }).success).toBe(false);
  });
});

describe('coupon errors', () => {
  it('map to a 409 with the reason as message', () => {
    for (const reason of ['COUPON_NOT_FOUND', 'COUPON_SOLD_OUT', 'COUPON_CHANGED', 'COUPON_IN_USE']) {
      const err = mapPgError(new Error(reason));
      expect(err.status).toBe(409);
      expect(err.code).toBe('CONFLICT');
      expect(err.message).toBe(reason);
    }
  });
});

describe('quotePublicPayload', () => {
  const quote = (coupon: PersistedQuote['coupon']): PersistedQuote => ({
    quoteId: 'q1',
    currency: 'EUR',
    locale: 'es',
    subtotalCents: 4500,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 4500,
    expiresAt: '2026-12-01T00:00:00Z',
    lines: [{ productId: 'p1', title: 'Taza', quantity: 1, unitAmountCents: 4500, listUnitCents: 5000, lineTotalCents: 4500 }],
    priceFingerprint: 'f',
    configVersion: 1,
    shipping: null,
    vatRegime: null,
    vatDiscountCents: 0,
    pickupMarketId: null,
    coupon,
  });

  it('shows the coupon and what it saved', () => {
    const payload = quotePublicPayload(quote({ code: 'NAVIDAD10', discountCents: 500, error: null, missingCents: null, missingUnits: null }));
    expect(payload.coupon).toMatchObject({ code: 'NAVIDAD10', discountCents: 500, error: null, message: null });
    expect(payload.coupon?.discountFormatted).toContain('5,00');
    expect(payload.lines[0]?.listUnitCents).toBe(5000);
  });

  it('says why a code was refused', () => {
    const payload = quotePublicPayload(quote({ code: 'NAVIDAD10', discountCents: 0, error: 'COUPON_MIN_SUBTOTAL', missingCents: 2001, missingUnits: null }));
    expect(payload.coupon?.error).toBe('COUPON_MIN_SUBTOTAL');
    expect(payload.coupon?.message).toContain('20,01');
  });

  it('has no coupon when none was typed', () => {
    expect(quotePublicPayload(quote(null)).coupon).toBeNull();
  });
});

describe('claimCoupon', () => {
  it('leaves the order alone when its use is taken', async () => {
    const { db, queries } = fakeDb();
    await claimCoupon(db, 'order-1', 'es', true);
    expect(queries.map((q) => q.text)).toEqual(['select public.claim_order_coupon($1)']);
  });

  it('cancels the order and answers 409 with the reason when the coupon no longer holds', async () => {
    const { db, queries } = fakeDb({
      query: (q) => {
        if (q.text.includes('claim_order_coupon')) throw new Error('COUPON_SOLD_OUT');
        return 1;
      },
    });
    const err = await claimCoupon(db, 'order-1', 'es', true).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'CONFLICT', status: 409, message: 'COUPON_SOLD_OUT' });
    expect((err as { details: { couponMessage: string } }).details.couponMessage).toBe('Este cupón se ha agotado.');
    expect(queries.map((q) => q.text)).toEqual([
      'select public.claim_order_coupon($1)',
      'select public.cancel_unpaid_order($1)',
    ]);
    expect(queries[1]!.values).toEqual(['order-1']);
  });

  it('still answers the reason when the order could not be cancelled', async () => {
    const { db } = fakeDb({
      query: (q) => {
        throw new Error(q.text.includes('claim_order_coupon') ? 'COUPON_CHANGED' : 'ORDER_NOT_CANCELLABLE');
      },
    });
    await expect(claimCoupon(db, 'order-1', 'en', true)).rejects.toMatchObject({ status: 409, message: 'COUPON_CHANGED' });
  });

  const refusing = (reason: string) =>
    fakeDb({
      query: (q) => {
        if (q.text.includes('claim_order_coupon')) throw new Error(reason);
        return 1;
      },
    }).db;

  it('tells a guest only that the email cannot be used, whichever "who" rule refused', async () => {
    for (const reason of ['COUPON_FIRST_ORDER', 'COUPON_USED', 'COUPON_EMAIL']) {
      const err = await claimCoupon(refusing(reason), 'order-1', 'es', false).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 409, message: 'COUPON_EMAIL' });
      expect((err as { details: { couponMessage: string } }).details.couponMessage).toBe('Este cupón no se puede usar con este email.');
    }
    const en = await claimCoupon(refusing('COUPON_USED'), 'order-1', 'en', false).catch((e: unknown) => e);
    expect((en as { details: { couponMessage: string } }).details.couponMessage).toBe("This code can't be used with this email.");
  });

  it('keeps the specific reason for a signed-in customer, and other reasons for a guest', async () => {
    await expect(claimCoupon(refusing('COUPON_FIRST_ORDER'), 'order-1', 'es', true)).rejects.toMatchObject({ message: 'COUPON_FIRST_ORDER' });
    await expect(claimCoupon(refusing('COUPON_USED'), 'order-1', 'es', true)).rejects.toMatchObject({ message: 'COUPON_USED' });
    await expect(claimCoupon(refusing('COUPON_SOLD_OUT'), 'order-1', 'es', false)).rejects.toMatchObject({ message: 'COUPON_SOLD_OUT' });
  });

  it('collapses the "who" reasons for a signed-in customer who typed another email, keeps them for their own in any case', async () => {
    const reason = async (account: string | undefined, typed: string | undefined, why: string) =>
      (await claimCoupon(refusing(why), 'order-1', 'es', ownEmail(account, typed)).catch((e: unknown) => e) as { message: string }).message;
    // Signed in as ana, but the order is for someone else: nothing about that person leaks.
    expect(await reason('ana@example.com', 'victima@example.com', 'COUPON_FIRST_ORDER')).toBe('COUPON_EMAIL');
    expect(await reason('ana@example.com', 'victima@example.com', 'COUPON_USED')).toBe('COUPON_EMAIL');
    // Her own email, typed in another case, or none typed: the specific reasons stay.
    expect(await reason('ana@example.com', ' ANA@Example.com ', 'COUPON_FIRST_ORDER')).toBe('COUPON_FIRST_ORDER');
    expect(await reason('ana@example.com', undefined, 'COUPON_USED')).toBe('COUPON_USED');
    // A guest has no account email.
    expect(await reason(undefined, 'victima@example.com', 'COUPON_USED')).toBe('COUPON_EMAIL');
    expect(await reason(undefined, undefined, 'COUPON_FIRST_ORDER')).toBe('COUPON_EMAIL');
  });

  it('does not cancel for an error that is not about the coupon', async () => {
    const { db, queries } = fakeDb({
      query: () => {
        throw new Error('ORDER_NOT_FOUND');
      },
    });
    await expect(claimCoupon(db, 'order-1', 'es', true)).rejects.toMatchObject({ status: 404 });
    expect(queries).toHaveLength(1);
  });
});

describe('quoteCouponCtx', () => {
  const account = { id: 'u1', email: 'Ana@Example.com' };

  it('drops the typed email for a guest: it could probe whether someone else has bought', () => {
    expect(quoteCouponCtx(null, 'victima@example.com')).toEqual({});
  });

  it('drops an email that is not the signed-in account\'s own', () => {
    expect(quoteCouponCtx(account, 'victima@example.com')).toEqual({ customer_id: 'u1' });
    expect(quoteCouponCtx(account)).toEqual({ customer_id: 'u1' });
  });

  it('keeps the email when it is the account\'s own, whatever its case', () => {
    expect(quoteCouponCtx(account, ' ana@example.COM ')).toEqual({ customer_id: 'u1', email: 'ana@example.COM' });
  });
});

describe('createPersistedQuote', () => {
  it('sends the database only the code, the email and the account', async () => {
    const row = {
      id: 'q1', locale: 'es', subtotal_cents: 0, shipping_cents: 0, tax_cents: 0, total_cents: 0, expires_at: 'x',
      price_fingerprint: 'f', config_version: 1, shipping_country: null, shipping_postal_code: null,
      shipping_zone_name: null, shipping_weight_grams: null, lines: [], coupon_code: 'NAVIDAD10', coupon_discount_cents: 0,
      coupon_error: 'COUPON_NOT_FOUND',
    };
    const { db, queries } = fakeDb({ query: () => row });
    const q = await createPersistedQuote(db, {
      cartOwnerHash: 'h'.repeat(20),
      locale: 'es',
      items: [{ productId: 'p', quantity: 1 }],
      couponCode: ' navidad 10 ',
      couponCtx: { email: 'a@b.es', customer_id: 'u1', pickup: true } as { email: string; customer_id: string },
    });
    const sent = queries[0]!.values.map(String).join('|');
    expect(sent).toContain('NAVIDAD10');
    expect(sent).toContain('{"email":"a@b.es","customer_id":"u1"}');
    expect(sent).not.toContain('pickup');
    expect(q.coupon).toMatchObject({ code: 'NAVIDAD10', error: 'COUPON_NOT_FOUND' });
  });
});

describe('releaseOwnerCouponOrders', () => {
  const released = (rows: unknown) =>
    fakeDb({ query: (q) => (q.text.includes('release_owner_coupon_orders') ? { result: rows } : undefined) });

  it('cancels the owner\'s earlier orders in the database and expires their Stripe sessions', async () => {
    const { db, queries } = released([
      { order_id: 'old-1', stripe_session_id: 'cs_old_1' },
      { order_id: 'old-2', stripe_session_id: null },
    ]);
    const expire = vi.fn(async () => ({}));
    await releaseOwnerCouponOrders(db, 'order-2', expire);
    expect(queries.map((q) => [q.text.replace(/\s+/g, ' ').trim(), q.values])).toEqual([
      ['select public.release_owner_coupon_orders($1) as result', ['order-2']],
    ]);
    expect(expire.mock.calls).toEqual([['cs_old_1']]);
  });

  it('logs a session Stripe would not expire and goes on with the next', async () => {
    const { db } = released([
      { order_id: 'old-1', stripe_session_id: 'cs_old_1' },
      { order_id: 'old-2', stripe_session_id: 'cs_old_2' },
    ]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const expire = vi.fn(async (id: string) => {
      if (id === 'cs_old_1') throw new Error('session already complete');
    });
    await expect(releaseOwnerCouponOrders(db, 'order-2', expire)).resolves.toBeUndefined();
    expect(expire.mock.calls).toEqual([['cs_old_1'], ['cs_old_2']]);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('never blocks the checkout when the database fails, and expires nothing then', async () => {
    const { db } = fakeDb({
      query: () => {
        throw new Error('connection reset');
      },
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const expire = vi.fn(async () => ({}));
    await expect(releaseOwnerCouponOrders(db, 'order-2', expire)).resolves.toBeUndefined();
    expect(expire).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('only cancels when Stripe is not connected', async () => {
    const { db, queries } = released([{ order_id: 'old-1', stripe_session_id: 'cs_old_1' }]);
    await expect(releaseOwnerCouponOrders(db, 'order-2', null)).resolves.toBeUndefined();
    expect(queries).toHaveLength(1);
  });
});

describe('stripeSessionExpiry', () => {
  const now = Date.parse('2026-11-26T10:00:00Z');
  const at = (iso: string) => Date.parse(iso) / 1000;

  it('ends the session with the stock reservation, not after Stripe\'s default day', () => {
    expect(stripeSessionExpiry('2026-11-26T10:35:00Z', now)).toBe(at('2026-11-26T10:35:00Z'));
    expect(stripeSessionExpiry(new Date('2026-11-26T10:35:00Z'), now)).toBe(at('2026-11-26T10:35:00Z'));
  });

  it('keeps within Stripe\'s bounds: 30 min (and a minute for the clocks) to 24 h', () => {
    expect(stripeSessionExpiry('2026-11-26T10:10:00Z', now)).toBe(at('2026-11-26T10:31:00Z'));
    expect(stripeSessionExpiry(null, now)).toBe(at('2026-11-26T10:31:00Z'));
    expect(stripeSessionExpiry('not a date', now)).toBe(at('2026-11-26T10:31:00Z'));
    expect(stripeSessionExpiry('2026-11-29T10:00:00Z', now)).toBe(at('2026-11-27T09:59:00Z'));
  });
});
