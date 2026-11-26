import { describe, expect, it } from 'vitest';
import { couponSchema } from '@/lib/domain/coupons';
import {
  buildCouponBody,
  couponToValues,
  emptyValues,
  endsAtFromDay,
  lastDayFromEndsAt,
  liveSummary,
  madridMidnight,
  validity,
  type CouponFormValues,
} from '@/lib/admin/couponForm';

const names = {
  categories: new Map([['11111111-1111-4111-8111-111111111111', 'Tazas']]),
  collections: new Map<string, string>(),
  products: new Map<string, string>(),
  zones: new Map<string, string>(),
};

const form = (patch: Partial<CouponFormValues> = {}): CouponFormValues => ({
  ...emptyValues(),
  code: 'navidad10',
  percent: '10',
  ...patch,
});

describe('Madrid days', () => {
  it('00:00 in winter is 23:00 UTC the day before, in summer 22:00', () => {
    expect(madridMidnight('2026-12-25')).toBe('2026-12-24T23:00:00.000Z');
    expect(madridMidnight('2026-07-02')).toBe('2026-07-01T22:00:00.000Z');
  });

  it('is right on the days the clocks change', () => {
    expect(madridMidnight('2026-03-29')).toBe('2026-03-28T23:00:00.000Z');
    expect(madridMidnight('2026-03-30')).toBe('2026-03-29T22:00:00.000Z');
    expect(madridMidnight('2026-10-25')).toBe('2026-10-24T22:00:00.000Z');
    expect(madridMidnight('2026-10-26')).toBe('2026-10-25T23:00:00.000Z');
  });

  it('«hasta el 24» is saved as the 25th at midnight and shown back as the 24th', () => {
    const endsAt = endsAtFromDay('2026-12-24');
    expect(endsAt).toBe(madridMidnight('2026-12-25'));
    expect(lastDayFromEndsAt(endsAt)).toBe('2026-12-24');
  });

  it('works at the end of a month and a year', () => {
    expect(lastDayFromEndsAt(endsAtFromDay('2026-12-31'))).toBe('2026-12-31');
    expect(lastDayFromEndsAt(endsAtFromDay('2026-02-28'))).toBe('2026-02-28');
  });
});

describe('buildCouponBody', () => {
  it('turns euros into cents, commas included, and the dates into Madrid midnights', () => {
    const { body, problem } = buildCouponBody(
      form({ kind: 'fixed', percent: '', amount: '5,50', minSubtotal: '20', startDay: '2026-12-01', endDay: '2026-12-24' }),
    );
    expect(problem).toBeNull();
    expect(body.amountCents).toBe(550);
    expect(body.minSubtotalCents).toBe(2000);
    expect(body.startsAt).toBe('2026-11-30T23:00:00.000Z');
    expect(body.endsAt).toBe('2026-12-24T23:00:00.000Z');
  });

  it('splits emails on lines, commas and spaces', () => {
    const { body } = buildCouponBody(form({ emails: 'a@x.com\nb@x.com, c@x.com ;d@x.com\n\n' }));
    expect(body.emails).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  });

  it('says what is missing for the chosen kind, and what is not a number', () => {
    expect(buildCouponBody(form({ percent: '' })).problem).toBe('Indica el porcentaje de descuento.');
    expect(buildCouponBody(form({ kind: 'nth_unit', nth: '', percent: '50' })).problem).toBe('Indica qué unidad lleva el descuento.');
    expect(buildCouponBody(form({ maxUses: 'muchos' })).problem).toBe('«Usos totales» tiene que ser un número.');
    expect(buildCouponBody(form({ maxUses: '2,5' })).problem).toBe('«Usos totales» tiene que ser un número entero.');
    expect(buildCouponBody(form({ startDay: '2026-12-10', endDay: '2026-12-01' })).problem).toMatch(/último día/);
    expect(buildCouponBody(form({ kind: 'free_shipping', percent: '' })).problem).toBeNull();
  });

  it('is accepted by the server schema, which drops what the kind does not use', () => {
    const { body } = buildCouponBody(
      form({
        kind: 'fixed',
        percent: '10',
        amount: '5',
        categoryIds: ['11111111-1111-4111-8111-111111111111'],
        weekdays: [6, 7],
      }),
    );
    const parsed = couponSchema.parse(body);
    expect(parsed.code).toBe('NAVIDAD10');
    expect(parsed.percent).toBeNull();
    expect(parsed.amountCents).toBe(500);
    expect(parsed.weekdays).toEqual([6, 7]);
  });

  it('reads only the chosen kind\'s values: a leftover invalid percent does not stop a fixed coupon', () => {
    const { body, problem } = buildCouponBody(form({ kind: 'fixed', percent: 'abc', amount: '5', nth: '1,5', buyQty: 'x' }));
    expect(problem).toBeNull();
    expect(body).toMatchObject({ percent: null, nth: null, buyQty: null, amountCents: 500 });
    expect(couponSchema.parse(body).amountCents).toBe(500);
    // The kind's own value is still judged.
    expect(buildCouponBody(form({ kind: 'fixed', amount: 'cinco' })).problem).toBe('«Importe» tiene que ser un número.');
  });

  it('keeps the status the coupon already has', () => {
    expect(buildCouponBody(form({ id: '22222222-2222-4222-8222-222222222222', status: 'paused' })).body.status).toBe('paused');
  });
});

describe('liveSummary', () => {
  it('describes the coupon in one line', () => {
    const live = liveSummary(
      form({
        categoryIds: ['11111111-1111-4111-8111-111111111111'],
        startDay: '2026-12-01',
        endDay: '2026-12-24',
        maxUsesPerCustomer: '1',
        maxUses: '100',
      }),
      names,
    );
    expect(live.ready).toBe(true);
    expect(live.text).toBe('−10 % en Tazas · del 1 al 24 dic · 1 uso por cliente · máx. 100 usos');
  });

  it('shows what is missing instead of a summary with holes', () => {
    expect(liveSummary(form({ percent: '' }), names)).toEqual({ text: 'Indica el porcentaje de descuento.', ready: false });
  });

  it('ignores a value left from another kind', () => {
    expect(liveSummary(form({ kind: 'fixed', percent: '10', amount: '5' }), names).text.replace(/\s/g, ' ')).toBe('−5,00 € en toda la tienda');
  });
});

describe('couponToValues', () => {
  it('shows a saved coupon back as it was typed', () => {
    const { body } = buildCouponBody(
      form({ id: '22222222-2222-4222-8222-222222222222', kind: 'fixed', amount: '5,5', startDay: '2026-12-01', endDay: '2026-12-24', emails: 'a@x.com' }),
    );
    const saved = couponSchema.parse(body);
    const values = couponToValues({ ...saved, id: saved.id!, version: 1 });
    expect(values).toMatchObject({ amount: '5,5', startDay: '2026-12-01', endDay: '2026-12-24', emails: 'a@x.com', code: 'NAVIDAD10' });
    expect(buildCouponBody(values).body).toEqual(buildCouponBody({ ...values }).body);
    expect(buildCouponBody(values).body.endsAt).toBe(body.endsAt);
  });
});

describe('validity', () => {
  const at = Date.parse('2026-12-10T12:00:00Z');
  it('says where today falls', () => {
    expect(validity({ startsAt: null, endsAt: null }, at)).toEqual({ text: 'Siempre', state: 'always' });
    expect(validity({ startsAt: madridMidnight('2026-12-01'), endsAt: endsAtFromDay('2026-12-24') }, at).state).toBe('live');
    expect(validity({ startsAt: madridMidnight('2026-12-20'), endsAt: null }, at)).toMatchObject({ state: 'scheduled' });
    expect(validity({ startsAt: null, endsAt: endsAtFromDay('2026-12-09') }, at)).toMatchObject({ state: 'ended' });
    expect(validity({ startsAt: null, endsAt: endsAtFromDay('2026-12-10') }, at).state).toBe('live');
  });
});
