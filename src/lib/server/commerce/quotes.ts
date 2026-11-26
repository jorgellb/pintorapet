import { json, type Db } from '@/lib/server/db';
import type { CartItem } from '@/lib/domain/cart';
import type { InvoiceCustomer } from '@/lib/domain/checkoutCustomer';
import { formatEur } from '@/lib/domain/money';
import { dbCall } from './pgErrors';
import { CommerceError } from './errors';

export interface QuoteLine {
  productId: string;
  title: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
  priceVersion?: number;
  sku?: string;
  slug?: string;
}

export interface PersistedQuote {
  quoteId: string;
  currency: 'EUR';
  locale: 'en' | 'es';
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  expiresAt: string;
  lines: QuoteLine[];
  priceFingerprint: string;
  configVersion: number;
  shipping: QuoteShipping | null;
  /** 'no_vat' for Canarias, Ceuta, Melilla and outside the EU: Spanish VAT is taken off. */
  vatRegime: 'es_vat' | 'no_vat' | null;
  vatDiscountCents: number;
  /** Picked up at this market (no shipping). */
  pickupMarketId: string | null;
}

export interface QuoteShipping {
  country: string;
  postalCode: string | null;
  zoneName: string;
  weightGrams: number;
}

type QuoteRow = {
  id: string;
  locale: 'en' | 'es';
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  expires_at: string;
  price_fingerprint: string;
  config_version: number;
  shipping_country: string | null;
  shipping_postal_code: string | null;
  shipping_zone_name: string | null;
  shipping_weight_grams: number | null;
  vat_regime?: 'es_vat' | 'no_vat' | null;
  vat_discount_cents?: number | null;
  pickup_market_id?: string | null;
  lines: Array<{
    product_id: string;
    quantity: number;
    unit_price_cents: number;
    line_subtotal_cents: number;
    price_version?: number;
    title?: string;
    sku?: string;
    slug?: string;
  }>;
};

export async function createPersistedQuote(
  supabase: Db,
  opts: {
    cartOwnerHash: string;
    locale: 'en' | 'es';
    items: CartItem[];
    country?: string;
    postalCode?: string;
    /** Picked up at a market: no shipping, no destination. */
    pickupMarketId?: string;
    invoice?: InvoiceCustomer;
  },
): Promise<PersistedQuote> {
  const p_lines = opts.items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
  }));

  const lineArray = json(p_lines);
  const data = await dbCall(() =>
    opts.pickupMarketId
      ? supabase.one<QuoteRow>`
          select * from public.create_pickup_quote(
            p_cart_owner_hash => ${opts.cartOwnerHash},
            p_locale => ${opts.locale}::public.locale_code,
            p_lines => array(select l from jsonb_populate_recordset(null::public.cart_line_input, ${lineArray}) l),
            p_market_id => ${opts.pickupMarketId}::uuid,
            p_invoice_customer => ${opts.invoice ? json(opts.invoice) : null})`
      : supabase.one<QuoteRow>`
    select * from public.create_checkout_quote(
      p_cart_owner_hash => ${opts.cartOwnerHash},
      p_locale => ${opts.locale}::public.locale_code,
      p_lines => array(select l from jsonb_populate_recordset(null::public.cart_line_input, ${json(p_lines)}) l),
      p_country => ${opts.country?.toUpperCase() ?? null},
      p_postal_code => ${opts.postalCode || null},
      p_invoice_customer => ${opts.invoice ? json(opts.invoice) : null})`);
  if (!data) {
    throw new CommerceError('INTERNAL', 'Quote RPC returned empty', 500);
  }

  const row = data as QuoteRow;
  const lines: QuoteLine[] = (row.lines ?? []).map((l) => ({
    productId: l.product_id,
    title: l.title ?? '',
    quantity: l.quantity,
    unitAmountCents: l.unit_price_cents,
    lineTotalCents: l.line_subtotal_cents,
    priceVersion: l.price_version,
    sku: l.sku,
    slug: l.slug,
  }));

  return {
    quoteId: row.id,
    currency: 'EUR',
    locale: row.locale,
    subtotalCents: row.subtotal_cents,
    shippingCents: row.shipping_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    expiresAt: row.expires_at,
    lines,
    priceFingerprint: row.price_fingerprint,
    configVersion: row.config_version,
    shipping: row.shipping_country
      ? {
          country: row.shipping_country,
          postalCode: row.shipping_postal_code,
          zoneName: row.shipping_zone_name ?? '',
          weightGrams: row.shipping_weight_grams ?? 0,
        }
      : null,
    vatRegime: row.vat_regime ?? null,
    vatDiscountCents: row.vat_discount_cents ?? 0,
    pickupMarketId: row.pickup_market_id ?? null,
  };
}

export function quotePublicPayload(quote: PersistedQuote) {
  return {
    quoteId: quote.quoteId,
    configured: true,
    currency: quote.currency,
    locale: quote.locale,
    subtotalCents: quote.subtotalCents,
    shippingCents: quote.shippingCents,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
    subtotalFormatted: formatEur(quote.subtotalCents, quote.locale),
    shippingFormatted: formatEur(quote.shippingCents, quote.locale),
    totalFormatted: formatEur(quote.totalCents, quote.locale),
    shippingPending: quote.shipping === null,
    shipping: quote.shipping,
    vatRegime: quote.vatRegime,
    vatDiscountCents: quote.vatDiscountCents,
    vatDiscountFormatted: formatEur(quote.vatDiscountCents, quote.locale),
    pickupMarketId: quote.pickupMarketId,
    expiresAt: quote.expiresAt,
    lines: quote.lines.map((l) => ({
      productId: l.productId,
      title: l.title,
      quantity: l.quantity,
      unitAmountCents: l.unitAmountCents,
      lineTotalCents: l.lineTotalCents,
    })),
  };
}
