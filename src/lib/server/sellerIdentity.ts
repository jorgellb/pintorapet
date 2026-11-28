import { serviceDb, type Db } from '@/lib/server/db';
import { SHOP_PHONE } from '@/lib/domain/whatsapp';

/**
 * Who sells, for the legal pages (LSSI art. 10). Name, brand and contact are
 * fixed; the tax id and address come from Admin › Ajustes › Facturación
 * (shop_settings.invoice_config), the same data the invoices print. A field
 * left empty there is null here, and the page leaves its line out.
 */
export type SellerIdentity = {
  name: string;
  brand: string;
  email: string;
  phone: string;
  taxId: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
};

export const SELLER = {
  name: 'Meili Stringfellow',
  brand: 'Pets Drawings',
  email: 'info@petsdrawings.com',
  phone: SHOP_PHONE,
} as const;

const filled = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Read on every request: the legal pages are rendered on the server. */
export async function sellerIdentity(client: Db | null = serviceDb()): Promise<SellerIdentity> {
  let fiscal: Record<string, unknown> = {};
  if (client) {
    try {
      const row = await client.one<{ invoice_config: unknown }>`
        select invoice_config from public.shop_settings where id = 1`;
      if (row?.invoice_config && typeof row.invoice_config === 'object') {
        fiscal = row.invoice_config as Record<string, unknown>;
      }
    } catch (err) {
      // The page still shows the fixed lines; only the fiscal ones are missing.
      console.error('[legal] seller identity unavailable', err instanceof Error ? err.message : err);
    }
  }
  return {
    ...SELLER,
    taxId: filled(fiscal.issuerNif),
    address: filled(fiscal.issuerAddress),
    postalCode: filled(fiscal.issuerPostalCode),
    city: filled(fiscal.issuerCity),
  };
}
