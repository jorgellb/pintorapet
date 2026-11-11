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

describe('customerStatus with the carrier’s states', () => {
  it('shows the parcel on its way, out for delivery, or in trouble', () => {
    expect(customerStatus('paid', 'in_transit', 'es')).toMatchObject({ key: 'shipped', step: 2 });
    expect(customerStatus('paid', 'out_for_delivery', 'es')).toMatchObject({ key: 'out_for_delivery', label: 'En reparto', step: 2 });
    expect(customerStatus('paid', 'incident', 'en')).toMatchObject({ key: 'incident', step: 2 });
    expect(customerStatus('paid', 'returned', 'es')).toMatchObject({ key: 'returned', step: 2 });
  });

  it('keeps following the parcel when only part was refunded', () => {
    expect(customerStatus('partially_refunded', 'shipped', 'es')).toMatchObject({ key: 'shipped', step: 2 });
    expect(customerStatus('refunded', 'unfulfilled', 'es').key).toBe('refunded');
  });

  it('says so when the order was cancelled or never paid', () => {
    expect(customerStatus('cancelled', 'unfulfilled', 'es')).toMatchObject({ key: 'cancelled', label: 'Cancelado' });
    expect(customerStatus('expired', 'unfulfilled', 'en')).toMatchObject({ key: 'cancelled', label: 'Not paid' });
  });
});
