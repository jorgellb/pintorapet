import { describe, expect, it } from 'vitest';
import { adminAbout, customerAbout, withCurrent, type AboutOption } from '../src/lib/admin/reviewView';

const P = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const inOrder: AboutOption[] = [{ value: `p:${P}`, label: 'Retrato' }];

describe('what a review is about, as the select holds it', () => {
  it("a customer's review follows its product only, even on a commission order", () => {
    // A commission order's review carries the commission id too; the customer's select cannot offer it.
    const onCommission = { productId: P, commissionRequestId: C };
    expect(customerAbout(onCommission)).toBe(`p:${P}`);
    expect(customerAbout({ productId: null, commissionRequestId: C })).toBe('');
  });

  it("Meili's own review: a commission wins over a product", () => {
    expect(adminAbout({ productId: P, commissionRequestId: C })).toBe(`c:${C}`);
    expect(adminAbout({ productId: P, commissionRequestId: null })).toBe(`p:${P}`);
    expect(adminAbout({ productId: null, commissionRequestId: null })).toBe('');
  });

  it('the current value is always in the list: a product no longer in the order is added', () => {
    const extra = withCurrent(inOrder, 'p:other', 'Producto — opción');
    expect(extra).toEqual([...inOrder, { value: 'p:other', label: 'Producto — opción' }]);
  });

  it('nothing is added when the value is already there, or when it is «En general»', () => {
    expect(withCurrent(inOrder, `p:${P}`, 'x')).toBe(inOrder);
    expect(withCurrent(inOrder, '', 'x')).toBe(inOrder);
  });
});
