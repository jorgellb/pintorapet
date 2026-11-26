import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '@/lib/server/db';
import { json } from '@/lib/server/db';
import { formatEur } from '@/lib/domain/money';
import { localizedPath } from '@/i18n/routes';
import { siteUrl } from '@/lib/server/env';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall, mapPgError } from '@/lib/server/commerce/pgErrors';
import { sendOutboxNow } from '@/lib/server/commerce/outbox';
import type { InvoiceCustomer } from '@/lib/domain/checkoutCustomer';

/**
 * Paying for a commission (see supabase/migrations/20261126000005_commission_payments.sql):
 * Meili quotes it in Admin › Encargos, the customer gets a link, chooses where it
 * goes (shipping by zone for the packed weight) and pays the whole quote.
 */
export type CommissionConfig = {
  /** VAT of a commission (21 until confirmed with the accountant; 10 for an original work of art). */
  vatRate: number;
  /** Packed weight of the drawing by size, in grams. */
  weights: { A4: number; A3: number; undecided: number };
  transferIban: string;
  transferHolder: string;
  /** How long a quote link stays valid. */
  quoteDays: number;
};

export const DEFAULT_COMMISSION_CONFIG: CommissionConfig = {
  vatRate: 21,
  weights: { A4: 250, A3: 450, undecided: 450 },
  transferIban: '',
  transferHolder: '',
  quoteDays: 30,
};

export const commissionConfigSchema = z
  .object({
    vatRate: z.number().min(0).max(30),
    weights: z.object({
      A4: z.number().int().min(1).max(30000),
      A3: z.number().int().min(1).max(30000),
      undecided: z.number().int().min(1).max(30000),
    }),
    transferIban: z
      .string()
      .trim()
      .max(42)
      .transform((v) => v.replace(/\s+/g, ' ').toUpperCase()),
    transferHolder: z.string().trim().max(120),
    quoteDays: z.number().int().min(1).max(180),
  })
  .strict();

export async function commissionConfig(client: Db): Promise<CommissionConfig> {
  const row = await client.one<{ commission_config: Partial<CommissionConfig> | null }>`
    select commission_config from public.shop_settings where id = 1`.catch(() => null);
  const saved = row?.commission_config ?? {};
  return { ...DEFAULT_COMMISSION_CONFIG, ...saved, weights: { ...DEFAULT_COMMISSION_CONFIG.weights, ...(saved.weights ?? {}) } };
}

export async function saveCommissionConfig(client: Db, config: CommissionConfig): Promise<void> {
  await dbCall(() => client.run`update public.shop_settings set commission_config = ${json(config)} where id = 1`);
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function payLink(locale: 'es' | 'en', reference: string, token: string): string {
  return `${siteUrl()}${localizedPath(locale, 'commissionPay')}?ref=${encodeURIComponent(reference)}&k=${encodeURIComponent(token)}`;
}

export const quoteSchema = z
  .object({
    priceCents: z.number().int().min(100).max(1_000_000),
    title: z.string().trim().min(3).max(140),
    note: z.string().trim().max(1000).default(''),
    weightGrams: z.number().int().min(1).max(30000).optional(),
  })
  .strict();

/** Quote a request and email the customer the link to pay it (a new link each time). */
export async function sendQuote(
  client: Db,
  service: Db,
  id: string,
  input: z.output<typeof quoteSchema>,
): Promise<{ link: string; emailed: boolean }> {
  const config = await commissionConfig(client);
  const request = await client.one<{ reference: string; locale: 'es' | 'en'; contact_name: string; contact_email: string; size_hint: string | null; paid_order_id: string | null }>`
    select reference, locale, contact_name, contact_email, size_hint, paid_order_id
    from public.commission_requests where id = ${id}`;
  if (!request) throw new CommerceError('UNAVAILABLE', 'Ese encargo no existe.', 404);
  if (request.paid_order_id) throw new CommerceError('CONFLICT', 'Este encargo ya está pagado.', 409);

  const size = (request.size_hint ?? 'undecided') as keyof CommissionConfig['weights'];
  const weight = input.weightGrams ?? config.weights[size] ?? config.weights.undecided;
  const token = randomBytes(24).toString('base64url');
  const until = new Date(Date.now() + config.quoteDays * 86_400_000);
  await dbCall(() => client.run`
    update public.commission_requests
    set status = 'quoted', quote_cents = ${input.priceCents}, quote_vat_rate = ${config.vatRate},
        quote_weight_grams = ${weight}, quote_title = ${input.title}, quote_note = ${input.note || null},
        quote_sent_at = now(), quote_until = ${until.toISOString()}, pay_token_hash = ${hashToken(token)}
    where id = ${id}`);

  const link = payLink(request.locale, request.reference, token);
  const dedupeKey = `commission_quote:${id}:${Date.now()}`;
  await service.run`
    insert into public.notification_outbox (dedupe_key, recipient, locale, template_key, payload, status, next_run_at)
    values (${dedupeKey}, ${request.contact_email}, ${request.locale}, 'commission_quote_customer', ${json({
      commission_id: id,
      reference: request.reference,
      name: request.contact_name,
      title: input.title,
      note: input.note,
      price: formatEur(input.priceCents, request.locale),
      link,
      until: new Intl.DateTimeFormat(request.locale === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(until),
    })}, 'pending', now())`;
  const emailed = await sendOutboxNow(service, dedupeKey);
  return { link, emailed };
}

export type PayableCommission = {
  id: string;
  reference: string;
  locale: 'es' | 'en';
  name: string;
  email: string;
  title: string;
  note: string;
  priceCents: number;
  until: string;
};

const LINK_ERRORS: Record<string, { es: string; en: string }> = {
  COMMISSION_LINK_INVALID: {
    es: 'Este enlace no es válido o ya se usó. Si ya pagaste, tu pedido está en camino; si no, escribe a Meili.',
    en: 'This link is not valid or has been used. If you have paid, your order is on its way; if not, write to Meili.',
  },
  COMMISSION_ALREADY_PAID: { es: 'Este encargo ya está pagado. ¡Gracias!', en: 'This commission is already paid. Thank you!' },
  COMMISSION_NOT_PAYABLE: {
    es: 'Este presupuesto ya no está disponible (ha caducado o ha cambiado). Escribe a Meili y te envía uno nuevo.',
    en: 'This quote is no longer available (it expired or changed). Write to Meili for a new one.',
  },
};

export function linkProblem(err: unknown, locale: 'es' | 'en'): string | null {
  const message = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
  const hit = Object.keys(LINK_ERRORS).find((code) => message.includes(code));
  return hit ? LINK_ERRORS[hit]![locale] : null;
}

/** The request a link opens, or why it cannot be paid. */
export async function payableCommission(service: Db, reference: string, token: string): Promise<PayableCommission> {
  const row = await service.one<{
    id: string; reference: string; locale: 'es' | 'en'; contact_name: string; contact_email: string;
    quote_title: string | null; quote_note: string | null; quote_cents: number; quote_until: string;
  }>`select * from public.commission_for_payment(${reference}, ${hashToken(token)})`;
  return {
    id: row!.id,
    reference: row!.reference,
    locale: row!.locale,
    name: row!.contact_name,
    email: row!.contact_email,
    title: row!.quote_title ?? '',
    note: row!.quote_note ?? '',
    priceCents: Number(row!.quote_cents),
    until: row!.quote_until,
  };
}

/** A checkout quote for the commission, to a destination (shipping by zone). */
export async function commissionCheckoutQuote(
  service: Db,
  input: { reference: string; token: string; cartOwnerHash: string; country: string; postalCode: string; invoice?: InvoiceCustomer },
) {
  try {
    const row = await service.one<{
      id: string; subtotal_cents: number; shipping_cents: number; total_cents: number; vat_regime: string;
      shipping_zone_name: string | null; vat_discount_cents: number | null; expires_at: string;
    }>`
      select * from public.create_commission_quote(
        ${input.reference}, ${hashToken(input.token)}, ${input.cartOwnerHash},
        ${input.country.toUpperCase()}, ${input.postalCode || null}, ${input.invoice ? json(input.invoice) : null})`;
    return {
      quoteId: row!.id,
      subtotalCents: row!.subtotal_cents,
      shippingCents: row!.shipping_cents,
      totalCents: row!.total_cents,
      noVat: row!.vat_regime === 'no_vat',
      zoneName: row!.shipping_zone_name,
      expiresAt: row!.expires_at,
    };
  } catch (err) {
    throw mapPgError(err);
  }
}

/** Bizum or transfer: the order waits for the money, as an order by phone does. */
export async function commissionManualOrder(
  service: Db,
  input: {
    reference: string;
    token: string;
    method: 'bizum' | 'transfer';
    quoteId: string;
    customer: { name: string; email: string; phone: string };
    address: Record<string, string>;
  },
): Promise<{ orderId: string; reference: string; totalCents: number }> {
  try {
    const out = await service.call<{ order_id: string; reference: string; total_cents: number }>('create_commission_manual_order', {
      p: {
        reference: input.reference,
        token_hash: hashToken(input.token),
        method: input.method,
        quote_id: input.quoteId,
        customer: input.customer,
        address: input.address,
      },
    });
    return { orderId: out.order_id, reference: out.reference, totalCents: out.total_cents };
  } catch (err) {
    throw mapPgError(err);
  }
}
