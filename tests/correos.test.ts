import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/db', () => ({ serviceDb: () => null, sql: () => null }));

const {
  cancelShipment,
  CorreosApiError,
  deliveryProof,
  publicCitypaqs,
  searchCitypaqs,
  shipmentLabelPdf,
  shipmentPayload,
  spanishPhone,
  trackShipment,
} = await import(
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

describe('deliveryProof', () => {
  const b64 = (text: string) => Buffer.from(text).toString('base64');

  it('gets the electronic proof of delivery as a PDF', async () => {
    reply({ shippingCode: 'PK1', format: 'pdf', content: b64('%PDF-1.4'), metadata: { contentType: 'application/pdf' } });
    const proof = await deliveryProof(cfg, 'PK1', 'pee');
    expect(String(apiCall()[0])).toContain('/digital-services/expclidocs/api/v1/pee/PK1?format=pdf');
    expect(proof).toMatchObject({ contentType: 'application/pdf', extension: 'pdf' });
    expect(proof.bytes.toString()).toBe('%PDF-1.4');
  });

  it('takes the signed document among the signatures', async () => {
    reply({
      shippingCode: 'PK1',
      format: 'jpg',
      documents: [
        { content: b64('unsigned'), metadata: { contentType: 'image/jpeg', signed: '0' } },
        { content: b64('signed'), metadata: { contentType: 'image/jpeg', signed: '1' } },
      ],
    });
    const proof = await deliveryProof(cfg, 'PK1', 'pod');
    expect(String(apiCall()[0])).toContain('/pod/PK1?format=jpg');
    expect(proof).toMatchObject({ contentType: 'image/jpeg', extension: 'jpg' });
    expect(proof.bytes.toString()).toBe('signed');
  });

  it('never serves a file type other than the one asked for', async () => {
    reply({ content: b64('<script>'), metadata: { contentType: 'text/html' } });
    expect((await deliveryProof(cfg, 'PK1', 'pee')).contentType).toBe('application/pdf');
  });

  it('says so when Correos has no proof yet', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/Authorize/Token')
        ? answer({ idToken: token }, 200)
        : answer({ code: 404, message: 'Not Found', moreInformation: { description: 'x' } }, 404),
    );
    await expect(deliveryProof(cfg, 'PK1', 'pod')).rejects.toThrow(/todavía no tiene/);
  });

  it('points at the contract when the proof is not allowed', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/Authorize/Token') ? answer({ idToken: token }, 200) : answer({ code: 403 }, 403),
    );
    await expect(deliveryProof(cfg, 'PK1', 'pee')).rejects.toThrow(/contrato/);
  });
});

describe('Citypaq lockers', () => {
  const locker = {
    terminalId: 'S1999942D',
    terminalState: 'ACTIVO',
    terminalType: 'P',
    modality: 'T',
    visibilityIndex: 'S',
    alias: 'REPSOL VIA DUBLIN',
    address: 'CALLE VIA DUBLIN 7 28020 MADRID',
    postalCode: '28020',
    municipality: 'MADRID',
    province: 'MADRID',
    openingDescription: '24 HORAS',
    latitudeWGS84: '40,36149087226',
    longitudeWGS84: '-3,78064967055',
  };

  it('keeps only active public lockers: never a private home one', () => {
    const lockers = publicCitypaqs([
      locker,
      { ...locker, terminalId: 'HOME', terminalType: 'DOMICILIARIO' },
      { ...locker, terminalId: 'PERSONAL', terminalType: 'DOM PERSONAL' },
      { ...locker, terminalId: 'CLOSED', terminalState: 'CLAUSURADO' },
      { ...locker, terminalId: 'HIDDEN', visibilityIndex: 'N' },
      { ...locker, terminalId: 'OFFICE', modality: 'E' },
    ]);
    expect(lockers.map((l) => l.id)).toEqual(['S1999942D']);
    expect(lockers[0]).toMatchObject({ name: 'REPSOL VIA DUBLIN', schedule: '24 HORAS', latitude: 40.36149087226, longitude: -3.78064967055 });
  });

  it('searches a postal code among active lockers', async () => {
    reply({ content: [locker] });
    const lockers = await searchCitypaqs(cfg, '28020');
    const url = new URL(String(apiCall()[0]));
    expect(url.pathname).toBe('/logistics/terminals/api/v1/homepaqs');
    expect(url.searchParams.get('postalCode')).toBe('28020');
    expect(url.searchParams.get('terminalStates')).toBe('ACTIVO');
    expect(lockers).toHaveLength(1);
  });

  it('looks around the postal code when it has none', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/Authorize/Token')) return answer({ idToken: token }, 200);
      return answer({ content: new URL(String(url)).searchParams.has('postalCodeBeg') ? [locker] : [] }, 200);
    });
    expect(await searchCitypaqs(cfg, '28021')).toHaveLength(1);
    const calls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('homepaqs'));
    expect(new URL(calls[1]).searchParams.get('postalCodeBeg')).toBe('280');
  });

  it('searches a town in the way Correos writes it', async () => {
    reply({ content: [] });
    await searchCitypaqs(cfg, ' Málaga ');
    expect(new URL(String(apiCall()[0])).searchParams.get('municipality')).toBe('MALAGA');
    fetchMock.mockClear();
    await searchCitypaqs(cfg, 'A Coruña');
    expect(new URL(String(apiCall()[0])).searchParams.get('municipality')).toBe('A CORUÑA');
  });

  it('treats "nothing found" as an empty list', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/Authorize/Token') ? answer({ idToken: token }, 200) : answer({ code: 404 }, 404),
    );
    await expect(searchCitypaqs(cfg, 'Villaperdida')).resolves.toEqual([]);
  });
});
