import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { packingSlipLines, renderAddressLabel, renderPackingSlip, type PrintableOrder } from '../src/lib/server/shipping/printables';

const MM = 72 / 25.4;

const order: PrintableOrder = {
  reference: 'PD-ABC123',
  locale: 'es',
  createdAt: '2026-11-11T10:00:00+01:00',
  weightGrams: 480,
  note: 'Es un regalo, por favor sin factura dentro',
  address: {
    name: 'Lucía Prueba',
    line1: 'Calle de la Paz 14, 3º B',
    line2: '',
    postal_code: '46001',
    city: 'Valencia',
    state: 'Valencia',
    country: 'ES',
    phone: '+34 600 000 000',
  },
  items: [
    { title: 'Taza Pug', sku: 'PD-2051', quantity: 2 },
    { title: 'Llavero Pug · Redondo', sku: 'PD-2068', quantity: 1 },
  ],
};

const sender = { name: 'Meili Stringfellow', address: 'Calle del Estudio 3', postalCode: '28013', locality: 'Madrid', phone: '600111222' };

describe('address label', () => {
  it('is an A6 page titled with the order', async () => {
    const doc = await PDFDocument.load(await renderAddressLabel(order, sender, 'Pets Drawings'));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width / MM)).toBe(105);
    expect(Math.round(height / MM)).toBe(148);
    expect(doc.getTitle()).toBe('Etiqueta PD-ABC123');
  });

  it('still prints without a sender address, or with characters fonts lack', async () => {
    const odd = { ...order, address: { ...order.address, name: 'Łucja 🐶 Prüfung' } };
    const doc = await PDFDocument.load(await renderAddressLabel(odd, {}, 'Pets Drawings'));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('packing slip', () => {
  it('is an A4 page in the customer’s language', async () => {
    const doc = await PDFDocument.load(await renderPackingSlip({ ...order, locale: 'en' }, 'Pets Drawings'));
    expect(Math.round(doc.getPage(0).getSize().width / MM)).toBe(210);
    expect(doc.getTitle()).toBe('Packing slip PD-ABC123');
  });

  it('lists what is left to send: refunded units are not in the box', () => {
    const lines = packingSlipLines(
      [
        { id: 'a', title: 'Taza Pug', sku: 'PD-2051', quantity: 2 },
        { id: 'b', title: 'Tarjeta Pug', sku: 'PD-2033', quantity: 1 },
      ],
      [
        { order_item_id: 'a', quantity: 1 },
        { order_item_id: 'b', quantity: 0 },
      ],
    );
    expect(lines).toEqual([{ title: 'Taza Pug', sku: 'PD-2051', quantity: 1 }]);
  });
});
