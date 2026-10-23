import { describe, expect, it } from 'vitest';
import { customerStatus } from '../src/lib/domain/orderStatus';

describe('customerStatus', () => {
  it('follows the journey of a paid order', () => {
    expect(customerStatus('paid', 'unfulfilled', 'es')).toMatchObject({ key: 'preparing', step: 1 });
    expect(customerStatus('paid', 'preparing', 'en')).toMatchObject({ key: 'preparing', label: 'Meili is preparing it' });
    expect(customerStatus('paid', 'shipped', 'es')).toMatchObject({ key: 'shipped', label: 'En camino', step: 2 });
    expect(customerStatus('paid', 'completed', 'es')).toMatchObject({ key: 'delivered', step: 3 });
  });

  it('names payments that are not settled yet', () => {
    expect(customerStatus('processing', 'unfulfilled', 'es').key).toBe('processing');
    expect(customerStatus('review', 'unfulfilled', 'en').label).toBe('Being checked');
    expect(customerStatus('refunded', 'shipped', 'es').key).toBe('refunded');
  });
});
