import { describe, expect, it } from 'vitest';
import { fakeDb } from './helpers/fakeDb';
import { marketDates, marketState, upcoming, type Market } from '../src/lib/domain/markets';
import { marketSaleSchema, sellAtStall } from '../src/lib/server/commerce/marketSales';
import { changeFor, countdown } from '../src/lib/domain/markets';
import { CommerceError } from '../src/lib/server/commerce/errors';

const market = (startsOn: string, endsOn: string): Market => ({
  id: 'm1', name: 'Mercado de Navidad', place: 'Plaza Mayor', city: 'Valencia', startsOn, endsOn,
  hours: '10:00–21:00', notesEs: '', notesEn: '', mapUrl: null, pickup: false, published: true,
});

describe('marketDates', () => {
  it('reads one day or a span, in each language', () => {
    expect(marketDates(market('2026-12-12', '2026-12-12'), 'es')).toBe('sábado 12 de diciembre');
    expect(marketDates(market('2026-12-12', '2026-12-14'), 'es')).toBe('del 12 al 14 de diciembre');
    expect(marketDates(market('2026-11-30', '2026-12-02'), 'es')).toBe('del 30 de noviembre al 2 de diciembre');
    expect(marketDates(market('2026-12-12', '2026-12-14'), 'en')).toBe('12–14 December');
  });
});

describe('marketState', () => {
  it('knows when Meili is there now', () => {
    expect(marketState(market('2026-12-12', '2026-12-14'), '2026-12-13')).toBe('now');
    expect(marketState(market('2026-12-12', '2026-12-14'), '2026-12-01')).toBe('soon');
    expect(marketState(market('2026-12-12', '2026-12-14'), '2026-12-15')).toBe('past');
  });

  it('lists the markets still to come, soonest first', () => {
    const list = [market('2026-12-20', '2026-12-20'), market('2026-11-01', '2026-11-02'), market('2026-12-12', '2026-12-14')];
    expect(upcoming(list, '2026-12-13').map((m) => m.startsOn)).toEqual(['2026-12-12', '2026-12-20']);
  });
});

describe('changeFor', () => {
  it('gives the change for cash, or nothing when short', () => {
    expect(changeFor(1998, '20')).toBe(2);
    expect(changeFor(1998, '50,00')).toBe(3002);
    expect(changeFor(1998, '10')).toBeNull();
    expect(changeFor(1998, '')).toBeNull();
  });
});

describe('sellAtStall', () => {
  const PRODUCT = '11111111-1111-4111-8111-111111111111';
  const input = marketSaleSchema.parse({ lines: [{ productId: PRODUCT, quantity: 2 }], method: 'cash' });

  it('sends the sale to the database', async () => {
    const { db, call } = fakeDb({ answer: () => ({ data: { order_id: 'o1', reference: 'PD-1', total_cents: 1998 } }) });
    expect(await sellAtStall(db, input)).toEqual({ orderId: 'o1', reference: 'PD-1', totalCents: 1998 });
    expect(call).toHaveBeenCalledWith('admin_market_sale', {
      p: { lines: [{ product_id: PRODUCT, quantity: 2 }], method: 'cash', market_id: null, customer: { name: '', email: '' }, locale: 'es' },
    });
  });

  it('takes cash, a card terminal or Bizum', () => {
    expect(() => marketSaleSchema.parse({ lines: [{ productId: PRODUCT, quantity: 1 }], method: 'stripe' })).toThrow();
  });

  it('says in Spanish when a piece has run out', async () => {
    const { db } = fakeDb({ answer: () => ({ error: { message: 'INSUFFICIENT_STOCK: PD-2051' } }) });
    const error = (await sellAtStall(db, input).catch((err: unknown) => err)) as CommerceError;
    expect(error.message).toBe('No queda stock de PD-2051: ya se vendió (en la web o en el puesto).');
  });
});


describe('countdown', () => {
  const m = market('2026-12-12', '2026-12-14');
  it('counts the days to the market', () => {
    expect(countdown(m, '2026-11-26', 'es')).toBe('Faltan 16 días');
    expect(countdown(m, '2026-12-11', 'es')).toBe('Mañana');
    expect(countdown(m, '2026-11-26', 'en')).toBe('In 16 days');
    expect(countdown(m, '2026-12-11', 'en')).toBe('Tomorrow');
  });

  it('says when Meili is there now, with the hours', () => {
    expect(countdown(m, '2026-12-13', 'es')).toBe('Hoy · 10:00–21:00');
    expect(countdown({ ...m, hours: '' }, '2026-12-13', 'en')).toBe('Today');
  });
});
