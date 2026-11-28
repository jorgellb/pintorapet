import { clientIp, ipKey } from '@/lib/server/antibot';
import { serviceDb } from '@/lib/server/db';

/** How many writes one IP may make to an anonymous route in a window (public.rate_limit_hit). */
export type RateRule = { bucket: string; limit: number; windowSeconds: number };

export const RATE = {
  // Each one reserves stock for 35 minutes; a person opens a few at most (20 leaves
  // room for several people behind one mobile-network IP).
  checkout: { bucket: 'checkout', limit: 20, windowSeconds: 60 * 60 },
  // Every change in the cart or the address prices it again (and tries a coupon).
  quote: { bucket: 'quote', limit: 60, windowSeconds: 10 * 60 },
  pageView: { bucket: 'page_view', limit: 300, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateRule>;

/**
 * Counts this request against the rule for the visitor's IP; false once it is
 * over. Without the database, or if the count fails, the request goes through:
 * a limit is never a reason to stop a sale.
 */
export async function withinLimit(
  rule: RateRule,
  context: { request: Request; clientAddress?: string },
): Promise<boolean> {
  const service = serviceDb();
  if (!service) return true;
  try {
    const row = await service.one<{ ok: boolean }>`
      select public.rate_limit_hit(${rule.bucket}, ${ipKey(clientIp(context))}, ${rule.limit}, ${rule.windowSeconds}) as ok`;
    return row?.ok !== false;
  } catch (err) {
    console.error('[rate limit] %s: not counted', rule.bucket, err);
    return true;
  }
}
