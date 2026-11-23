import { iso3 } from '@/lib/domain/countries';
import { serviceDb, sql } from '@/lib/server/db';

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
  const supabase = serviceDb();
  if (!supabase) return null;
  // Secrets come out of the vault, which needs the key for that transaction.
  const [row, secretRows] = await Promise.all([
    supabase.one<Record<string, string | null>>`select * from public.shipping_carriers where carrier = 'correos'`.catch(() => null),
    supabase
      .withVaultKey<{ secrets: Record<string, string> | null }>(sql`select public.carrier_secrets(p_carrier => 'correos') as secrets`)
      .catch(() => []),
  ]);
  const secrets = secretRows[0]?.secrets ?? null;
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
  const supabase = serviceDb();
  const data = supabase
    ? await supabase.one<{ shipping_config: unknown }>`select shipping_config from public.shop_settings where id = 1`.catch(() => null)
    : null;
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
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; description?: string; body?: string };
  if (res.status === 401 || res.status === 403) {
    throw new CorreosApiError('Correos rechazó las credenciales de la API (client_id / client_secret).', res.status);
  }
  if (!res.ok) {
    throw new CorreosApiError(data.description || data.body || data.message || `Correos respondió con un error (${res.status}).`, res.status);
  }
  return data;
}

type CorreosError = { errorCode?: string | number; description?: string; errorFieldName?: string };

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

/** A Spanish phone as Correos wants it: 9 digits starting with 6, 7, 8 or 9. Anything else is left out. */
export function spanishPhone(value: string | undefined): string | undefined {
  const digits = (value ?? '').replace(/\D/g, '').replace(/^(0034|34)(?=\d{9}$)/, '');
  return /^[6789]\d{8}$/.test(digits) ? digits : undefined;
}

/** One shipment of POST /delivery (Preregister v1). */
export function shipmentPayload(cfg: CorreosConfig, settings: ShippingSettings, input: ShipmentInput) {
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
      // Required abroad: an undeliverable parcel comes back to Meili.
      ...(spain ? {} : { instructionsDoNotDeliver: 'D' }),
      customsData: input.items.map((item) => ({
        quantity: String(item.quantity),
        description: clip(`${settings.customsDescription} — ${item.title}`, 50),
        netWeight: String(item.weightGrams * item.quantity),
        netValue: ((item.unitPriceCents * item.quantity) / 100).toFixed(2),
        countryOrigin: 'ESP',
      })),
    };
  }

  return {
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
      contactPhone: spanishPhone(sender.phone),
      email: clip(sender.email, 50) || undefined,
    },
    addressee: {
      name: clip(input.addressee.name, 50),
      address: clip([input.addressee.line1, input.addressee.line2].filter(Boolean).join(', '), 100),
      locality: clip(input.addressee.city, 40),
      // A 2-digit Spanish province code: it does not exist abroad.
      province: spain ? input.addressee.postalCode.slice(0, 2) : undefined,
      cp: spain ? input.addressee.postalCode : undefined,
      zip: spain ? undefined : clip(input.addressee.postalCode, 10),
      country,
      contactPhone: spain ? spanishPhone(input.addressee.phone) : clip(input.addressee.phone, 15) || undefined,
      email: clip(input.addressee.email, 50) || undefined,
    },
    packages: [pkg],
  };
}

/** Registers the parcel with Correos; returns the code printed on the label and used for tracking. */
export async function preregisterShipment(
  cfg: CorreosConfig,
  settings: ShippingSettings,
  input: ShipmentInput,
): Promise<{ shipmentCode: string; packageCode: string }> {
  const shipment = shipmentPayload(cfg, settings, input);

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
export async function shipmentLabelPdf(cfg: CorreosConfig, packageCode: string, customs: boolean): Promise<Buffer> {
  const data = await call<{ pdf?: string; error?: string }>(cfg, 'POST', '/support/labels/api/v1/labels/print', {
    documentationType: customs ? 0 : 1,
    application: 'P3',
    print: {
      shipments: [packageCode],
      labelFormat: 2,
      labelPrintMode: 1,
      labelOrderType: 4,
    },
  });
  if (!data.pdf) throw new CorreosApiError(data.error || 'Correos no devolvió la etiqueta.', 502);
  return Buffer.from(data.pdf, 'base64');
}

export async function cancelShipment(cfg: CorreosConfig, packageCode: string): Promise<void> {
  // Correos answers 201 even when it refuses: the refusal comes in `errors`.
  const data = await call<{ message?: string; errors?: CorreosError[] }>(
    cfg,
    'POST',
    '/admissions/preregister/api/v1/delivery/annulment',
    { packageCode, errorCodeLanguage: 'spa' },
  );
  const errors = data.errors ?? [];
  if (errors.length > 0) {
    const detail = errors.map((e) => e.description || e.errorCode).filter(Boolean).join(' · ');
    throw new CorreosApiError(`Correos no anuló el envío: ${detail || data.message || 'sin motivo'}`, 409);
  }
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

/** A parcel's tracking events (API gateway, trackpub v2). The raw answer: see tracking.ts. */
export async function trackShipment(cfg: CorreosConfig, code: string): Promise<unknown> {
  return call<unknown>(cfg, 'GET', `/support/trackpub/api/v2/search/${encodeURIComponent(code)}?languageCode=ES`);
}

// --- Proof of delivery (Expclidocs) ------------------------------------------

export type ProofKind = 'pee' | 'pod';

// Always one of these two types: what Correos labels a document is not trusted.
const PROOFS: Record<ProofKind, { format: string; contentType: string; extension: string }> = {
  pee: { format: 'pdf', contentType: 'application/pdf', extension: 'pdf' },
  pod: { format: 'jpg', contentType: 'image/jpeg', extension: 'jpg' },
};

type ProofDocument = { content?: string; metadata?: { signed?: string } };

/** The electronic proof of delivery (pee, PDF) or the signature (pod, image) of a parcel. */
export async function deliveryProof(
  cfg: CorreosConfig,
  code: string,
  kind: ProofKind,
): Promise<{ bytes: Buffer; contentType: string; extension: string }> {
  const proof = PROOFS[kind];
  let data: ProofDocument & { documents?: ProofDocument[] };
  try {
    data = await call(cfg, 'GET', `/digital-services/expclidocs/api/v1/${kind}/${encodeURIComponent(code)}?format=${proof.format}`);
  } catch (err) {
    if (err instanceof CorreosApiError && err.status === 404) {
      throw new CorreosApiError('Correos todavía no tiene esta prueba de entrega.', 404);
    }
    if (err instanceof CorreosApiError && err.status === 403) {
      throw new CorreosApiError(
        'Correos no da acceso a este documento. Comprueba que el contrato incluye las pruebas de entrega y que la aplicación está suscrita a Expclidocs.',
        403,
      );
    }
    throw err;
  }
  const documents = data.documents ?? [data];
  const chosen = documents.find((d) => d.metadata?.signed === '1') ?? documents[0];
  if (!chosen?.content) throw new CorreosApiError('Correos todavía no tiene esta prueba de entrega.', 404);
  return { bytes: Buffer.from(chosen.content, 'base64'), contentType: proof.contentType, extension: proof.extension };
}

// --- Citypaq lockers (Terminals) ----------------------------------------------

export type Citypaq = {
  /** The code a parcel is addressed to (addressee.homepaqCode). */
  id: string;
  name: string;
  address: string;
  postalCode: string;
  municipality: string;
  province: string;
  schedule: string;
  latitude: number | null;
  longitude: number | null;
};

const words = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
/** Correos writes some coordinates with a decimal comma. */
const coordinate = (value: unknown) => {
  const number = Number(words(value).replace(',', '.'));
  return words(value) && Number.isFinite(number) ? number : null;
};

/** Only lockers anyone can use: active, visible, public. Never a private home locker. */
export function publicCitypaqs(rows: unknown[]): Citypaq[] {
  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const t = raw as Record<string, unknown>;
    const id = words(t.terminalId);
    const open = words(t.terminalState).toUpperCase() === 'ACTIVO';
    const isPublic = /^P/i.test(words(t.terminalType));
    if (!id || !open || !isPublic || words(t.visibilityIndex).toUpperCase() === 'N' || words(t.modality).toUpperCase() === 'E') {
      return [];
    }
    return [
      {
        id,
        name: words(t.alias) || words(t.channelDescription) || id,
        address: words(t.address) || words(t.location),
        postalCode: words(t.postalCode),
        municipality: words(t.municipality) || words(t.locality),
        province: words(t.province),
        schedule: words(t.openingDescription) || words(t.scheduleIndex),
        latitude: coordinate(t.latitudeWGS84) ?? coordinate(t.latitudeETRS89),
        longitude: coordinate(t.longitudeWGS84) ?? coordinate(t.longitudeETRS89),
      },
    ];
  });
}

async function terminals(cfg: CorreosConfig, filter: Record<string, string>): Promise<unknown[]> {
  const params = new URLSearchParams({ terminalStates: 'ACTIVO', currPage: '0', itemsPage: '30', ...filter });
  try {
    const data = await call<{ content?: unknown[] }>(cfg, 'GET', `/logistics/terminals/api/v1/homepaqs?${params}`);
    return Array.isArray(data.content) ? data.content : [];
  } catch (err) {
    if (err instanceof CorreosApiError && err.status === 404) return [];
    throw err;
  }
}

/** A town as Correos stores it: capitals, no accents, but keeping the Ñ. */
const townName = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .normalize('NFD')
    .replace(/(N\u0303)|[\u0300-\u036f]/g, (_match, enye) => (enye ? 'Ñ' : ''));

/** Lockers for a postal code (and around it, if it has none) or a town. */
export async function searchCitypaqs(cfg: CorreosConfig, query: string): Promise<Citypaq[]> {
  const q = query.trim();
  if (!/^\d{5}$/.test(q)) return publicCitypaqs(await terminals(cfg, { municipality: townName(q) }));
  const exact = publicCitypaqs(await terminals(cfg, { postalCode: q }));
  return exact.length > 0 ? exact : publicCitypaqs(await terminals(cfg, { postalCodeBeg: q.slice(0, 3) }));
}
