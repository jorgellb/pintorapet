import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/db', () => ({ serviceDb: () => null, sql: () => null }));

const { cancelShipment, CorreosApiError, shipmentLabelPdf, shipmentPayload, spanishPhone, trackShipment } = await import(
  '../src/lib/server/shipping/correos'
);

const cfg = {
  mode: 'test' as const,
  contractNumber: '12345678',
  clientNumber: '87654321',
  labellerCode: 'AB12',
  oauthClientId: `id-${Math.random()}`,
  oauthClientSecret: 'secret',
  gatewayClientId: 'gateway',
  gatewayClientSecret: 'gateway-secret',
};
const settings = {
  packagingGrams: 150,
  customsDescription: 'Ilustraciones impresas',
  sender: { name: 'Meili', address: 'Calle Mayor 1', locality: 'Madrid', postalCode: '28013', phone: '+34 636 386 531', email: 'a@example.com' },
};
const input = (country: string, phone = '+34 600 111 222') => ({
  reference: 'PD-1',
  product: 'PAAZE',
  weightGrams: 480,
  customs: country !== 'ES',
  valueCents: 999,
  items: [{ title: 'Taza', quantity: 1, unitPriceCents: 999, weightGrams: 330 }],
  addressee: { name: 'Ana', line1: 'Rue 1', city: 'Paris', state: 'Île-de-France', postalCode: country === 'ES' ? '46001' : '75001', country, phone },
});

const token = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.y`;
const answer = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
/** First call of a fresh client is the token; every call answers `body`. */
const reply = (body: unknown) =>
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/Authorize/Token') ? answer({ idToken: token }, 200) : answer(body),
  );
const apiCall = () => fetchMock.mock.calls.find(([url]) => !String(url).includes('/Authorize/Token'))!;

describe('spanishPhone', () => {
  it('leaves the 9 digits Correos asks for', () => {
    expect(spanishPhone('+34 636 386 531')).toBe('636386531');
    expect(spanishPhone('0034 912-345-678')).toBe('912345678');
  });
  it('drops what Correos would refuse', () => {
    expect(spanishPhone('123')).toBeUndefined();
    expect(spanishPhone('512345678')).toBeUndefined();
    expect(spanishPhone(undefined)).toBeUndefined();
  });
});

describe('shipmentPayload', () => {
  it('sends Spanish phones as 9 digits', () => {
    const shipment = shipmentPayload(cfg, settings, input('ES'));
    expect(shipment.sender.contactPhone).toBe('636386531');
    expect(shipment.addressee.contactPhone).toBe('600111222');
    expect(shipment.addressee.province).toBe('46');
  });
  it('says what to do with an undeliverable international parcel', () => {
    const pkg = shipmentPayload(cfg, settings, input('FR')).packages[0] as { packageContents: Record<string, unknown> };
    expect(pkg.packageContents.instructionsDoNotDeliver).toBe('D');
  });
  it('sends no province abroad: the field is a 2-digit Spanish code', () => {
    const shipment = shipmentPayload(cfg, settings, input('FR'));
    expect(shipment.addressee.province).toBeUndefined();
    expect(shipment.addressee.zip).toBe('75001');
  });
});

describe('labels', () => {
  it('asks only for the fields the API defines', async () => {
    reply({ pdf: Buffer.from('%PDF').toString('base64') });
    await shipmentLabelPdf(cfg, 'PK10YS9800069360128108B', false);
    const body = JSON.parse(apiCall()[1].body);
    expect(body.print.shipments).toEqual(['PK10YS9800069360128108B']);
    expect(body.print).not.toHaveProperty('preregisterInd');
  });
});

describe('cancelShipment', () => {
  it('fails when Correos answers with annulment errors', async () => {
    reply({ message: 'KO', errors: [{ errorCode: 12, description: 'Envío ya admitido' }] });
    await expect(cancelShipment(cfg, 'PK1')).rejects.toThrow(/Envío ya admitido/);
    await expect(cancelShipment(cfg, 'PK1')).rejects.toBeInstanceOf(CorreosApiError);
  });
  it('succeeds with no errors', async () => {
    reply({ message: 'OK', errors: [] });
    await expect(cancelShipment(cfg, 'PK1')).resolves.toBeUndefined();
  });
});

describe('trackShipment', () => {
  it('asks in Spanish, the language its events are read in', async () => {
    reply({ events: [] });
    await trackShipment(cfg, 'PK1');
    expect(String(apiCall()[0])).toContain('/support/trackpub/api/v2/search/PK1?languageCode=ES');
  });
});
