import { describe, expect, it } from 'vitest';
import { formatVerifactuAmount, verifactuChain, verifactuHash, verifactuQrUrl } from '../src/lib/domain/verifactu';

const FIRST = {
  issuerNif: '89890001K',
  number: '12345678/G33',
  issuedOn: '01-01-2024',
  kind: 'F1' as const,
  vatCents: 1235,
  totalCents: 12345,
  prevHash: '',
  generatedAt: '2024-01-01T19:20:30+01:00',
};

const FIRST_CHAIN =
  'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00';

const FIRST_HASH = '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60';

describe('formatVerifactuAmount', () => {
  it('prints cents as a two-decimal period amount', () => {
    expect(formatVerifactuAmount(1235)).toBe('12.35');
    expect(formatVerifactuAmount(100)).toBe('1.00');
    expect(formatVerifactuAmount(0)).toBe('0.00');
  });
});

describe('verifactuHash', () => {
  it('matches the official AEAT first-record vector', () => {
    expect(verifactuChain(FIRST)).toBe(FIRST_CHAIN);
    expect(verifactuHash(FIRST)).toBe(FIRST_HASH);
  });

  it('chains the previous hash into the next record', () => {
    const second = {
      ...FIRST,
      number: '12345679/G33',
      prevHash: FIRST_HASH,
      generatedAt: '2024-01-01T19:20:35+01:00',
    };
    expect(verifactuChain(second)).toContain(`Huella=${FIRST_HASH}`);
    expect(verifactuHash(second)).toMatch(/^[A-F0-9]{64}$/);
    expect(verifactuHash(second)).not.toBe(FIRST_HASH);
  });
});

describe('verifactuQrUrl', () => {
  it('builds the AEAT cotejo URL', () => {
    expect(
      verifactuQrUrl({
        nif: '89890001K',
        number: 'S2026-0001',
        date: '23-10-2026',
        totalCents: 3687,
      }),
    ).toBe(
      'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=S2026-0001&fecha=23-10-2026&importe=36.87',
    );
  });
});
