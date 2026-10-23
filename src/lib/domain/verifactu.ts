import { createHash } from 'node:crypto';

export type VerifactuKind = 'F1' | 'F2';

export type VerifactuInput = {
  issuerNif: string;
  number: string;
  issuedOn: string;
  kind: VerifactuKind;
  vatCents: number;
  totalCents: number;
  prevHash: string;
  generatedAt: string;
};

export function formatVerifactuAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function verifactuChain(input: VerifactuInput): string {
  return [
    `IDEmisorFactura=${input.issuerNif.trim()}`,
    `NumSerieFactura=${input.number.trim()}`,
    `FechaExpedicionFactura=${input.issuedOn.trim()}`,
    `TipoFactura=${input.kind}`,
    `CuotaTotal=${formatVerifactuAmount(input.vatCents)}`,
    `ImporteTotal=${formatVerifactuAmount(input.totalCents)}`,
    `Huella=${input.prevHash.trim()}`,
    `FechaHoraHusoGenRegistro=${input.generatedAt.trim()}`,
  ].join('&');
}

export function verifactuHash(input: VerifactuInput): string {
  return createHash('sha256').update(verifactuChain(input), 'utf8').digest('hex').toUpperCase();
}

export function verifactuQrUrl(input: {
  nif: string;
  number: string;
  date: string;
  totalCents: number;
}): string {
  const q = new URLSearchParams({
    nif: input.nif,
    numserie: input.number,
    fecha: input.date,
    importe: formatVerifactuAmount(input.totalCents),
  });
  return `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?${q.toString()}`;
}
