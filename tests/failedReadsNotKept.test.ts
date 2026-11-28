import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb';

// One answer per query, in order: an Error makes that query fail.
const answers: unknown[] = [];
const { db, queries } = fakeDb({
  query: () => {
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  },
});
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  serviceDb: () => db,
}));

const { publicMarkets } = await import('../src/lib/server/markets');
const { shippingHighlights } = await import('../src/lib/server/shipping/highlights');

const marketRow = {
  id: 'm1', name: 'Mercado de Navidad', place: 'Plaza Mayor', city: 'Valencia', starts_on: '2099-12-12',
  ends_on: '2099-12-14', hours: '10:00–21:00', notes_es: '', notes_en: '', map_url: null, pickup: false,
  published: true, photos: [],
};
const zone = { name_es: 'Península', name_en: 'Mainland Spain', free_over_cents: 6000, holiday_deadline: null };

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  answers.length = 0;
  queries.length = 0;
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe('a failed database read is not kept for five minutes', () => {
  it('markets: the next page asks again, then the answer is kept', async () => {
    answers.push(new Error('connection terminated'), [marketRow]);
    expect(await publicMarkets()).toEqual([]);
    expect(errors).toHaveBeenCalledWith('[markets] read failed', 'connection terminated');
    expect((await publicMarkets()).map((m) => m.id)).toEqual(['m1']);
    expect((await publicMarkets()).map((m) => m.id)).toEqual(['m1']);
    expect(queries).toHaveLength(2);
  });

  it('shipping notices: the next page asks again, then the answer is kept', async () => {
    answers.push(new Error('timeout exceeded when trying to connect'), [zone]);
    expect(await shippingHighlights('es')).toEqual({ freeShipping: null, holiday: null });
    expect(errors).toHaveBeenCalledWith('[shipping] highlights read failed', 'timeout exceeded when trying to connect');
    // Intl puts a no-break space before the euro sign.
    expect((await shippingHighlights('es')).freeShipping).toMatch(/^Envío gratis desde 60\s€ \(Península\)$/);
    expect((await shippingHighlights('en')).freeShipping).toMatch(/^Free shipping from €60 \(Mainland Spain\)$/);
    expect(queries).toHaveLength(2);
  });
});
