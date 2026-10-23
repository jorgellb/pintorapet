import type { AstroCookies } from 'astro';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AccountProfile } from '@/lib/domain/accountProfile';
import { createUserServerClient } from '@/lib/server/supabase';

export type CustomerSession = { client: SupabaseClient; user: User };

/** The signed-in visitor, if any. Admins are customers too when they shop. */
export async function customerSession(
  cookies: AstroCookies,
  request: Request,
): Promise<CustomerSession | null> {
  const client = createUserServerClient(cookies, request);
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { client, user: data.user };
}

export function emptyProfile(user: User): AccountProfile {
  const name = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '';
  return { full_name: name, phone: '', address: null, billing: null };
}

/** The profile row, created on first visit from what was given at sign-up. */
export async function loadProfile({ client, user }: CustomerSession): Promise<AccountProfile> {
  const { data } = await client
    .from('customers')
    .select('full_name, phone, address, billing')
    .eq('id', user.id)
    .maybeSingle();
  if (data) {
    return {
      full_name: data.full_name ?? '',
      phone: data.phone ?? '',
      address: data.address ?? null,
      billing: data.billing ?? null,
    } as AccountProfile;
  }
  const fresh = emptyProfile(user);
  await client.from('customers').insert({ id: user.id, full_name: fresh.full_name });
  return fresh;
}

export async function saveProfile(
  { client, user }: CustomerSession,
  profile: AccountProfile,
): Promise<boolean> {
  const { error } = await client.from('customers').upsert({ id: user.id, ...profile });
  return !error;
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

export async function listOrders({ client }: CustomerSession): Promise<OrderSummary[]> {
  const { data, error } = await client.rpc('customer_orders');
  if (error) return [];
  return (data ?? []) as OrderSummary[];
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
    kind: 'simplified' | 'full';
    full_number: string;
    issued_at: string;
    total_cents: number;
    replaces_invoice_id: string | null;
  }>;
};

export async function getOrder({ client }: CustomerSession, reference: string): Promise<OrderDetail | null> {
  const { data, error } = await client.rpc('customer_order', { p_reference: reference });
  if (error || !data) return null;
  return data as OrderDetail;
}

/** Friendly, non-revealing messages for Supabase Auth errors. */
export function authErrorKey(
  message: string | undefined,
): 'credentials' | 'unconfirmed' | 'exists' | 'weak' | 'rate' | 'email' | 'mail' | 'generic' {
  const text = (message ?? '').toLowerCase();
  if (text.includes('invalid login') || text.includes('invalid credentials')) return 'credentials';
  if (text.includes('email address') && text.includes('invalid')) return 'email';
  if (text.includes('sending') || text.includes('not authorized') || text.includes('smtp')) return 'mail';
  if (text.includes('not confirmed')) return 'unconfirmed';
  if (text.includes('already registered') || text.includes('already been registered')) return 'exists';
  if (text.includes('password')) return 'weak';
  if (text.includes('rate') || text.includes('too many') || text.includes('security purposes')) return 'rate';
  return 'generic';
}
