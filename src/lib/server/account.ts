import type { AstroCookies } from 'astro';
import type { AccountProfile } from '@/lib/domain/accountProfile';
import { sessionUser, type SessionUser } from '@/lib/server/auth';
import { asUser } from '@/lib/server/db';

export type CustomerSession = { user: SessionUser };

/** The signed-in visitor, if any. Admins are customers too when they shop. */
export async function customerSession(
  cookies: AstroCookies,
  request: Request,
): Promise<CustomerSession | null> {
  const user = await sessionUser(cookies, request);
  return user ? { user } : null;
}

export function emptyProfile(user: SessionUser): AccountProfile {
  return { full_name: user.name ?? '', phone: '', address: null, billing: null };
}

/** The profile row, created on first visit from what was given at sign-up. RLS: own row only. */
export async function loadProfile({ user }: CustomerSession): Promise<AccountProfile> {
  return asUser(user.id, async (tx) => {
    const row = await tx.one<AccountProfile>`
      select full_name, phone, address, billing from public.customers where id = ${user.id}`;
    if (row) {
      return {
        full_name: row.full_name ?? '',
        phone: row.phone ?? '',
        address: row.address ?? null,
        billing: row.billing ?? null,
      } as AccountProfile;
    }
    const fresh = emptyProfile(user);
    await tx.run`insert into public.customers (id, full_name) values (${user.id}, ${fresh.full_name})
                 on conflict (id) do nothing`;
    return fresh;
  });
}

export async function saveProfile({ user }: CustomerSession, profile: AccountProfile): Promise<boolean> {
  try {
    await asUser(user.id, (tx) => tx.run`
      insert into public.customers (id, full_name, phone, address, billing)
      values (${user.id}, ${profile.full_name}, ${profile.phone}, ${profile.address}, ${profile.billing})
      on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone,
                                     address = excluded.address, billing = excluded.billing`);
    return true;
  } catch {
    return false;
  }
}

export type OrderSummary = {
  reference: string;
  created_at: string;
  paid_at: string | null;
  payment_status: string;
  fulfillment_status: string;
  total_cents: number;
  shipped_at: string | null;
  item_count: number;
  items: Array<{ title: string; quantity: number; product_id: string | null }>;
};

export async function listOrders({ user }: CustomerSession): Promise<OrderSummary[]> {
  try {
    const row = await asUser(user.id, (tx) => tx.one<{ result: OrderSummary[] | null }>`
      select public.customer_orders() as result`);
    return row?.result ?? [];
  } catch {
    return [];
  }
}

export type OrderDetail = Omit<OrderSummary, 'item_count' | 'items'> & {
  locale: 'en' | 'es';
  customer_email: string | null;
  customer_name: string | null;
  shipping_address: Record<string, string> | null;
  shipping_zone_name: string | null;
  carrier: string | null;
  tracking_code: string | null;
  subtotal_cents: number;
  shipping_cents: number;
  invoice_customer: Record<string, string> | null;
  items: Array<{
    title: string;
    sku: string;
    product_id: string | null;
    quantity: number;
    unit_price_cents: number;
    line_subtotal_cents: number;
  }>;
  invoices: Array<{
    id: string;
    kind: 'simplified' | 'full' | 'rectifying';
    full_number: string;
    issued_at: string;
    total_cents: number;
    replaces_invoice_id: string | null;
  }>;
};

export async function getOrder({ user }: CustomerSession, reference: string): Promise<OrderDetail | null> {
  try {
    const row = await asUser(user.id, (tx) => tx.one<{ result: OrderDetail | null }>`
      select public.customer_order(p_reference => ${reference}) as result`);
    return row?.result ?? null;
  } catch {
    return null;
  }
}

type AuthErrorKey = 'credentials' | 'unconfirmed' | 'exists' | 'weak' | 'rate' | 'email' | 'mail' | 'generic';

/** Friendly, non-revealing keys for Better Auth errors (APIError: statusCode + body.code). */
export function authErrorKey(err: unknown): AuthErrorKey {
  if (!err || typeof err !== 'object') return 'generic';
  const { statusCode, body, message } = err as { statusCode?: number; body?: { code?: string }; message?: string };
  if (statusCode === 429) return 'rate';
  const code = body?.code ?? '';
  if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_PASSWORD' || code === 'USER_NOT_FOUND') return 'credentials';
  if (code === 'EMAIL_NOT_VERIFIED') return 'unconfirmed';
  if (code.startsWith('USER_ALREADY_EXISTS')) return 'exists';
  if (code === 'INVALID_EMAIL') return 'email';
  if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') return 'weak';
  if (String(message ?? '').startsWith('MAIL_FAILED')) return 'mail';
  return 'generic';
}
