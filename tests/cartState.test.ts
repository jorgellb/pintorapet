import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseCartState } from '@/lib/domain/cart';
import { cartItemSchema } from '@/lib/validation/checkout';

// The zod schema the cart store used before it dropped zod from the browser.
const zodCartState = z.object({
  version: z.literal(1),
  items: z.array(cartItemSchema).max(20),
});

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const line = (quantity: unknown, productId: unknown = id) => ({ productId, quantity });

const SAMPLES: Array<[string, unknown]> = [
  ['an empty cart', { version: 1, items: [] }],
  ['two lines', { version: 1, items: [line(2), line(20, other)] }],
  ['the same product twice', { version: 1, items: [line(1), line(3)] }],
  ['20 lines', { version: 1, items: Array.from({ length: 20 }, () => line(1)) }],
  ['21 lines', { version: 1, items: Array.from({ length: 21 }, () => line(1)) }],
  ['extra keys', { version: 1, items: [{ ...line(1), price: 1 }], owner: 'x' }],
  ['version 2', { version: 2, items: [] }],
  ['version as text', { version: '1', items: [] }],
  ['no items', { version: 1 }],
  ['items not a list', { version: 1, items: {} }],
  ['quantity 0', { version: 1, items: [line(0)] }],
  ['quantity 21', { version: 1, items: [line(21)] }],
  ['quantity 1.5', { version: 1, items: [line(1.5)] }],
  ['quantity as text', { version: 1, items: [line('2')] }],
  ['quantity NaN', { version: 1, items: [line(Number.NaN)] }],
  ['quantity Infinity', { version: 1, items: [line(Number.POSITIVE_INFINITY)] }],
  ['not a uuid', { version: 1, items: [line(1, 'taza-pug')] }],
  ['a uuid of no version', { version: 1, items: [line(1, '11111111-1111-0111-8111-111111111111')] }],
  ['the nil uuid', { version: 1, items: [line(1, '00000000-0000-0000-0000-000000000000')] }],
  ['an upper-case uuid', { version: 1, items: [line(1, id.toUpperCase())] }],
  ['a line that is null', { version: 1, items: [null] }],
  ['null', null],
  ['a list', []],
  ['a string', 'cart'],
];

describe('parseCartState', () => {
  it.each(SAMPLES)('accepts and rejects like the zod schema: %s', (_name, value) => {
    const zod = zodCartState.safeParse(value);
    expect(parseCartState(value)).toEqual(zod.success ? zod.data : null);
  });

  it('keeps only productId and quantity', () => {
    expect(parseCartState({ version: 1, items: [{ ...line(2), price: 1 }] })).toEqual({
      version: 1,
      items: [{ productId: id, quantity: 2 }],
    });
  });
});
