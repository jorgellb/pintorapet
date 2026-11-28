import { SHIPPING_COUNTRIES } from '@/lib/domain/countries';
import type { DestinationRate } from '@/lib/seo/structuredData';
import { json, serviceDb } from '@/lib/server/db';

/**
 * What checkout would charge to send one unit of a product to each country
 * it ships to, for the product page's structured data. Asked of
 * public.shipping_quote itself, so zones, weight bands, packaging, free
 * shipping and VAT are the checkout's own. Spain is asked once per region
 * (es_region: one postal code each), since its rates differ by region.
 */
const SPAIN_POSTAL_CODES = ['28001', '07001', '35001', '51001', '52001'];

type Destination = { country: string; postal: string | null };

const DESTINATIONS = SHIPPING_COUNTRIES.flatMap((country): Destination[] =>
  country === 'ES' ? SPAIN_POSTAL_CODES.map((postal) => ({ country, postal })) : [{ country, postal: null }],
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEEP_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<DestinationRate[]> }>();

async function load(productId: string): Promise<DestinationRate[]> {
  const db = serviceDb();
  if (!db) return [];
  const rows = await db.rows<{ country: string; result: { available?: boolean; shipping_cents?: number } }>`
    select d.country, public.shipping_quote(
      p_lines => array[row(${productId}::uuid, 1)::public.cart_line_input],
      p_country => d.country, p_postal_code => d.postal) as result
    from jsonb_to_recordset(${json(DESTINATIONS)}) as d(country text, postal text)`;
  return rows.map((row) => ({
    country: row.country,
    cents: row.result?.available && typeof row.result.shipping_cents === 'number' ? row.result.shipping_cents : null,
  }));
}

/** Kept five minutes per product; a failed read gives no rates and is not kept. */
export function singleUnitRates(productId: string): Promise<DestinationRate[]> {
  if (!UUID.test(productId)) return Promise.resolve([]);
  const hit = cache.get(productId);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  const value = load(productId).catch((err: unknown) => {
    if (cache.get(productId)?.value === value) cache.delete(productId);
    console.error('[shipping] rates for structured data unavailable:', err instanceof Error ? err.message : String(err));
    return [];
  });
  cache.set(productId, { at: Date.now(), value });
  return value;
}
