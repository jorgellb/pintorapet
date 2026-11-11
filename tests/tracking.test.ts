import { describe, expect, it } from 'vitest';
import { carrierStatusOf, nextFulfillment, parseCorreosTracking } from '../src/lib/server/shipping/tracking';

describe('carrierStatusOf', () => {
  it('reads what each Correos event means for the order', () => {
    expect(carrierStatusOf({ text: 'Pre-registrado' })).toBeNull();
    expect(carrierStatusOf({ text: 'Admitido' })).toBe('in_transit');
    expect(carrierStatusOf({ text: 'En tránsito' })).toBe('in_transit');
    expect(carrierStatusOf({ text: 'En reparto' })).toBe('out_for_delivery');
    expect(carrierStatusOf({ text: 'Entregado' })).toBe('completed');
    expect(carrierStatusOf({ text: 'No entregado. Destinatario ausente' })).toBe('incident');
    expect(carrierStatusOf({ text: 'Disponible para recoger en oficina' })).toBe('incident');
    expect(carrierStatusOf({ text: 'Devuelto al remitente' })).toBe('returned');
  });

  it('falls back on the phase when the text says nothing it knows', () => {
    expect(carrierStatusOf({ text: 'Clasificación automática', phase: 2 })).toBe('in_transit');
    expect(carrierStatusOf({ text: 'Evento 5', phase: 4 })).toBe('completed');
  });
});

describe('parseCorreosTracking', () => {
  it('takes the shipment’s events, oldest first, and the state of the latest', () => {
    const parsed = parseCorreosTracking({
      shipment: [
        {
          shipmentCode: 'PK0000000000000000000001',
          events: [
            { eventDate: '10/11/2026', eventTime: '18:20:00', phase: '3', summaryText: 'En reparto' },
            { eventDate: '09/11/2026', eventTime: '09:15:00', phase: '2', summaryText: 'Admitido' },
            { eventDate: '08/11/2026', eventTime: '17:00:00', phase: '1', summaryText: 'Pre-registrado' },
          ],
        },
      ],
    });
    expect(parsed.events.map((e) => e.text)).toEqual(['Pre-registrado', 'Admitido', 'En reparto']);
    expect(parsed.events[0].at).toBe('2026-11-08T17:00:00+01:00');
    expect(parsed.status).toBe('out_for_delivery');
    expect(parsed.summary).toBe('En reparto');
  });

  it('copes with other shapes and with nothing useful', () => {
    expect(parseCorreosTracking([{ events: [{ date: '2026-11-10T12:00:00Z', description: 'Entregado' }] }]).status).toBe('completed');
    expect(parseCorreosTracking({ eventos: [{ fecha: '10/11/2026', hora: '12:00', desTextoResumen: 'Admitido' }] }).status).toBe('in_transit');
    expect(parseCorreosTracking({ error: 'not found' })).toEqual({ events: [], status: null, summary: null });
    expect(parseCorreosTracking(null).events).toEqual([]);
  });
});

describe('nextFulfillment', () => {
  it('moves the order forward with the carrier, never back', () => {
    expect(nextFulfillment('shipped', 'in_transit')).toBe('in_transit');
    expect(nextFulfillment('unfulfilled', 'in_transit')).toBe('in_transit');
    expect(nextFulfillment('out_for_delivery', 'in_transit')).toBe('out_for_delivery');
    expect(nextFulfillment('shipped', null)).toBe('shipped');
  });

  it('flags trouble at once and recovers from it', () => {
    expect(nextFulfillment('out_for_delivery', 'incident')).toBe('incident');
    expect(nextFulfillment('incident', 'out_for_delivery')).toBe('out_for_delivery');
    expect(nextFulfillment('in_transit', 'returned')).toBe('returned');
  });

  it('leaves a delivered or returned order alone', () => {
    expect(nextFulfillment('completed', 'incident')).toBe('completed');
    expect(nextFulfillment('returned', 'in_transit')).toBe('returned');
  });
});
