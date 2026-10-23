import { iso3 } from '@/lib/domain/countries';
import { createServiceClient } from '@/lib/server/supabase';

export type CarrierMode = 'test' | 'live';

export interface CorreosConfig {
  mode: CarrierMode;
  contractNumber: string;
  clientNumber: string;
  labellerCode: string;
  oauthClientId: string;
  oauthClientSecret: string;
  gatewayClientId: string;
  gatewayClientSecret: string;
}

export interface Sender {
  name: string;
  company?: string;
  address: string;
  locality: string;
  postalCode: string;
  phone: string;
  email: string;
}

export interface ShippingSettings {
  packagingGrams: number;
  customsDescription: string;
  sender: Partial<Sender>;
}

export class CorreosApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: string[] = [],
  ) {
    super(message);
    this.name = 'CorreosApiError';
  }
}

const HOSTS: Record<CarrierMode, { auth: string; api: string }> = {
  test: { auth: 'https://apioauthcid.correospre.es', api: 'https://api1.correospre.es' },
  live: { auth: 'https://apioauthcid.correos.es', api: 'https://api1.correos.es' },
};

export const CORREOS_PRODUCTS: Array<{ code: string; label: string; scope: 'national' | 'international' }> = [
  { code: 'PAAZE', label: 'Paq Estándar', scope: 'national' },
  { code: 'PAFXB', label: 'Paq Premium', scope: 'national' },
  { code: 'S0236', label: 'Paq Ligero', scope: 'national' },
  { code: 'PQDOM', label: 'Paquete Azul', scope: 'national' },
  { code: 'S0107', label: 'Paquete Internacional Prioritario', scope: 'international' },
  { code: 'S0108', label: 'Paquete Internacional Económico', scope: 'international' },
  { code: 'POAZE', label: 'Paq Estándar Internacional', scope: 'international' },
  { code: 'POAFXB', label: 'Paq Premium Internacional', scope: 'international' },
  { code: 'S0076', label: 'EMS Postal Express', scope: 'international' },
];

export function trackingUrl(code: string, locale: 'en' | 'es' = 'es'): string {
  const lang = locale === 'es' ? 'es/es' : 'es/en';
  return `https://www.correos.es/${lang}/herramientas/localizador/envios/detalle?tracking-number=${encodeURIComponent(code)}`;
}

let cached: { at: number; value: CorreosConfig | null } | null = null;

export function clearCorreosConfigCache(): void {
  cached = null;
}

export async function loadCorreosConfig(): Promise<CorreosConfig | null> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const supabase = createServiceClient();
  if (!supabase) return null;
  const [{ data: row }, { data: secrets }] = await Promise.all([
    supabase.from('shipping_carriers').select('*').eq('carrier', 'correos').maybeSingle(),
    supabase.rpc('carrier_secrets', { p_carrier: 'correos' }),
  ]);
  const s = (secrets ?? {}) as Record<string, string>;
  const value =
    row && s.oauth_client_secret && s.gateway_client_secret
      ? {
          mode: row.mode as CarrierMode,
          contractNumber: row.contract_number ?? '',
          clientNumber: row.client_number ?? '',
          labellerCode: row.labeller_code ?? '',
          oauthClientId: row.oauth_client_id ?? '',
          oauthClientSecret: s.oauth_client_secret,
          gatewayClientId: row.gateway_client_id ?? '',
          gatewayClientSecret: s.gateway_client_secret,
        }
      : null;
  cached = { at: Date.now(), value };
  return value;
}

export async function loadShippingSettings(): Promise<ShippingSettings> {
  const supabase = createServiceClient();
  const { data } = supabase
    ? await supabase.from('shop_settings').select('shipping_config').eq('id', 1).maybeSingle()
    : { data: null };
  const raw = (data?.shipping_config ?? {}) as Partial<ShippingSettings>;
  return {
    packagingGrams: Number(raw.packagingGrams ?? 150),
    customsDescription: raw.customsDescription || 'Ilustraciones impresas / Printed illustrations',
    sender: raw.sender ?? {},
  };
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch {
    // Opaque token: fall back to the documented lifetime.
  }
  return Date.now() + 25 * 60_000;
}

export async function correosToken(cfg: CorreosConfig): Promise<string> {
  const key = `${cfg.mode}:${cfg.oauthClientId}`;
  const hit = tokens.get(key);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;

  const res = await fetch(`${HOSTS[cfg.mode].auth}/Api/Authorize/Token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.oauthClientId,
      client_secret: cfg.oauthClientSecret,
      scope: 'AP3 LBS RCG',
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res) throw new CorreosApiError('No se pudo contactar con Correos.', 502);
  const body = (await res.json().catch(() => ({}))) as { idToken?: string; access_token?: string };
  const token = body.idToken ?? body.access_token;
  if (res.status >= 500) throw new CorreosApiError('Correos no responde ahora mismo. Inténtalo en unos minutos.', 502);
  if (!res.ok || !token) {
    throw new CorreosApiError('Correos no aceptó el identificador o el secreto de Correos ID.', 401);
  }
  tokens.set(key, { token, expiresAt: jwtExpiry(token) });
  return token;
}

async function call<T>(cfg: CorreosConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const token = await correosToken(cfg);
  const res = await fetch(`${HOSTS[cfg.mode].api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      client_id: cfg.gatewayClientId,
      client_secret: cfg.gatewayClientSecret,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res) throw new CorreosApiError('No se pudo contactar con Correos.', 502);
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; description?: string };
  if (res.status === 401 || res.status === 403) {
    throw new CorreosApiError('Correos rechazó las credenciales de la API (client_id / client_secret).', res.status);
  }
  if (!res.ok) {
    throw new CorreosApiError(data.description || data.message || `Correos respondió con un error (${res.status}).`, res.status);
  }
  return data;
}

type CorreosError = { errorCode?: string; description?: string; errorFieldName?: string };

type PreregisterResponse = {
  fileIdentifier?: string;
  result?: number;
  shipments?: Array<{
    validationErrorCount?: number;
    shipmentCode?: string;
    packages?: Array<{ packageId?: string; packageCode?: string }>;
    error?: CorreosError[];
  }>;
};

export interface ShipmentInput {
  reference: string;
  product: string;
  weightGrams: number;
  customs: boolean;
  valueCents: number;
  items: Array<{ title: string; quantity: number; unitPriceCents: number; weightGrams: number }>;
  addressee: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
    phone?: string;
    email?: string;
  };
}

const clip = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max);

/** Registers the parcel with Correos; returns the code printed on the label and used for tracking. */
export async function preregisterShipment(
  cfg: CorreosConfig,
  settings: ShippingSettings,
  input: ShipmentInput,
): Promise<{ shipmentCode: string; packageCode: string }> {
  const sender = settings.sender;
  if (!sender.name || !sender.address || !sender.locality || !sender.postalCode) {
    throw new CorreosApiError('Completa la dirección del remitente en Envíos antes de crear el envío.', 400);
  }
  const country = iso3(input.addressee.country);
  if (!country) throw new CorreosApiError('Correos no admite este país de destino desde la tienda.', 400);
  const spain = input.addressee.country.toUpperCase() === 'ES';

  const pkg: Record<string, unknown> = { packageWeightGrams: String(input.weightGrams) };
  if (input.customs) {
    pkg.packageContents = {
      shipmentType: '2',
      customsData: input.items.map((item) => ({
        quantity: String(item.quantity),
        description: clip(`${settings.customsDescription} — ${item.title}`, 50),
        netWeight: String(item.weightGrams * item.quantity),
        netValue: ((item.unitPriceCents * item.quantity) / 100).toFixed(2),
        countryOrigin: 'ESP',
      })),
    };
  }

  const shipment = {
    product: input.product,
    deliveryMethod: 'DOUAOF',
    contractNumber: cfg.contractNumber,
    clientNumber: cfg.clientNumber,
    labellerCode: cfg.labellerCode,
    packagesNumber: '1',
    shipmentReference1: clip(input.reference, 30),
    sender: {
      name: clip(sender.name, 50),
      company: clip(sender.company, 50) || undefined,
      address: clip(sender.address, 100),
      locality: clip(sender.locality, 40),
      province: sender.postalCode.slice(0, 2),
      cp: sender.postalCode,
      country: 'ESP',
      contactPhone: clip(sender.phone, 15) || undefined,
      email: clip(sender.email, 50) || undefined,
    },
    addressee: {
      name: clip(input.addressee.name, 50),
      address: clip([input.addressee.line1, input.addressee.line2].filter(Boolean).join(', '), 100),
      locality: clip(input.addressee.city, 40),
      province: spain ? input.addressee.postalCode.slice(0, 2) : clip(input.addressee.state, 40) || undefined,
      ...(spain ? { cp: input.addressee.postalCode } : { zip: clip(input.addressee.postalCode, 10) }),
      country,
      contactPhone: clip(input.addressee.phone, 15) || undefined,
      email: clip(input.addressee.email, 50) || undefined,
    },
    packages: [pkg],
  };

  const data = await call<PreregisterResponse>(cfg, 'POST', '/admissions/preregister/api/v1/delivery', {
    shipments: [shipment],
    errorCodeLanguage: 'spa',
  });
  const first = data.shipments?.[0];
  const errors = first?.error ?? [];
  if (!first?.shipmentCode || errors.length > 0) {
    const detail = errors.map((e) => e.description || e.errorCode).filter(Boolean).join(' · ');
    throw new CorreosApiError(
      detail ? `Correos no aceptó el envío: ${detail}` : 'Correos no devolvió el código del envío.',
      422,
      errors.map((e) => e.errorFieldName ?? '').filter(Boolean),
    );
  }
  return {
    shipmentCode: first.shipmentCode,
    packageCode: first.packages?.[0]?.packageCode ?? first.shipmentCode,
  };
}

/** Label (and CN22/CN23 when the parcel needs customs) as a PDF. */
export async function shipmentLabelPdf(cfg: CorreosConfig, shipmentCode: string, customs: boolean): Promise<Buffer> {
  const data = await call<{ pdf?: string; error?: string }>(cfg, 'POST', '/support/labels/api/v1/labels/print', {
    documentationType: customs ? 0 : 1,
    application: 'P3',
    print: {
      shipments: [shipmentCode],
      labelFormat: 2,
      labelPrintMode: 1,
      preregisterInd: 1,
      labelOrderType: 4,
    },
  });
  if (!data.pdf) throw new CorreosApiError(data.error || 'Correos no devolvió la etiqueta.', 502);
  return Buffer.from(data.pdf, 'base64');
}

export async function cancelShipment(cfg: CorreosConfig, packageCode: string): Promise<void> {
  await call(cfg, 'POST', '/admissions/preregister/api/v1/delivery/annulment', { packageCode });
}

/** Checks both credential pairs: Correos ID (token) and the API gateway (a tracking lookup). */
export async function testCorreos(cfg: CorreosConfig): Promise<void> {
  await correosToken(cfg);
  try {
    await call(cfg, 'GET', '/support/trackpub/api/v2/search/PQ000000000000000000');
  } catch (err) {
    if (err instanceof CorreosApiError && (err.status === 401 || err.status === 403)) throw err;
  }
}
