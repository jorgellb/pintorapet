import type { Db } from '@/lib/server/db';
import { z } from 'zod';
import { CommerceError } from './errors';
import { mapPgError } from './pgErrors';

/**
 * A sale at the stall (Admin › Mercados › Vender): paid at once (cash, card
 * terminal or Bizum), handed over, its pieces out of the stock immediately and
 * its ticket issued. See supabase/migrations/20261126000002_markets.sql.
 */
export const marketSaleSchema = z
  .object({
    lines: z
      .array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(99) }).strict())
      .min(1)
      .max(50),
    method: z.enum(['cash', 'terminal', 'bizum']),
    marketId: z.uuid().nullable().default(null),
    customer: z
      .object({ name: z.string().trim().max(160).default(''), email: z.string().trim().max(254).default('') })
      .strict()
      .default({ name: '', email: '' }),
    locale: z.enum(['es', 'en']).default('es'),
  })
  .strict();

export type MarketSaleInput = z.output<typeof marketSaleSchema>;

const KNOWN: Array<[string, string, number]> = [
  ['MARKET_SALE_METHOD', 'Elige cómo te paga: efectivo, tarjeta o Bizum.', 400],
  ['MARKET_NOT_FOUND', 'Ese mercado ya no existe. Recarga la página.', 409],
  ['MANUAL_ORDER_EMAIL', 'El email no es válido (o déjalo vacío).', 400],
  ['MANUAL_ORDER_EMPTY', 'Añade al menos una pieza.', 400],
  ['MANUAL_ORDER_QUANTITY', 'Las cantidades van de 1 a 99.', 400],
  ['PRODUCT_UNAVAILABLE', 'Una de las piezas ya no está publicada.', 409],
  ['INVENTORY_UNVERIFIED', 'Una de las piezas no tiene el stock verificado. Revísalo en Stock.', 409],
];

function explain(err: unknown): CommerceError {
  const message = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
  const stock = /INSUFFICIENT_STOCK:\s*(\S+)/.exec(message);
  if (stock) return new CommerceError('UNAVAILABLE', `No queda stock de ${stock[1]}: ya se vendió (en la web o en el puesto).`, 409);
  const known = KNOWN.find(([code]) => message.includes(code));
  return known ? new CommerceError('VALIDATION', known[1], known[2]) : mapPgError(err);
}

export async function sellAtStall(
  client: Db,
  input: MarketSaleInput,
): Promise<{ orderId: string; reference: string; totalCents: number }> {
  try {
    const out = await client.call<{ order_id: string; reference: string; total_cents: number }>('admin_market_sale', {
      p: {
        lines: input.lines.map((line) => ({ product_id: line.productId, quantity: line.quantity })),
        method: input.method,
        market_id: input.marketId,
        customer: input.customer,
        locale: input.locale,
      },
    });
    return { orderId: out.order_id, reference: out.reference, totalCents: out.total_cents };
  } catch (err) {
    throw explain(err);
  }
}
