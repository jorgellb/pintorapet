import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accountProfileSchema } from '@/lib/domain/accountProfile';
import { CommerceError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { siteUrl } from '@/lib/server/env';

/** What the admin edits: the account email plus the customer's profile. */
export const adminCustomerSchema = accountProfileSchema.extend({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

export const adminCreateCustomerSchema = adminCustomerSchema.extend({
  sendPasswordLink: z.boolean().default(false),
});

export type AdminCustomerRow = {
  kind: 'account' | 'guest';
  id: string | null;
  email: string;
  confirmed: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  full_name: string;
  phone: string;
  city: string | null;
  country: string | null;
  has_billing: boolean;
  is_admin: boolean;
  order_count: number;
  spent_cents: number;
  last_order_at: string | null;
};

export type AdminCustomerDetail = {
  id: string;
  email: string;
  confirmed: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  full_name: string;
  phone: string;
  address: Record<string, string> | null;
  billing: Record<string, string> | null;
  orders: Array<{
    id: string;
    reference: string;
    created_at: string;
    payment_status: string;
    fulfillment_status: string;
    total_cents: number;
    linked: boolean;
  }>;
};

export async function listCustomers(client: SupabaseClient): Promise<AdminCustomerRow[]> {
  const { data, error } = await client.rpc('admin_customers');
  if (error) throw mapPgError(error);
  return (data ?? []) as AdminCustomerRow[];
}

export async function getCustomer(client: SupabaseClient, id: string): Promise<AdminCustomerDetail | null> {
  const { data, error } = await client.rpc('admin_customer', { p_id: id });
  if (error) return null;
  return data as AdminCustomerDetail;
}

/** True when the account belongs to the admin team (active or not). */
export async function isAdminAccount(service: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await service.from('admin_users').select('user_id').eq('user_id', id).maybeSingle();
  if (error) throw new CommerceError('INTERNAL', 'No se pudo comprobar la cuenta.', 500);
  return Boolean(data);
}

/**
 * Other admins' accounts are not managed from Clientes: changing their email or
 * mailing them a password link would hand their access to someone else.
 */
export async function assertManageable(service: SupabaseClient, id: string, selfId: string): Promise<void> {
  if (id !== selfId && (await isAdminAccount(service, id))) {
    throw new CommerceError('FORBIDDEN', 'Es otra cuenta de administración: no se cambia desde Clientes.', 403);
  }
}

/** Translate Supabase Auth admin errors into messages for the panel. */
export function authAdminError(message: string | undefined): CommerceError {
  const text = (message ?? '').toLowerCase();
  if (text.includes('already') && (text.includes('registered') || text.includes('exists'))) {
    return new CommerceError('CONFLICT', 'Ya hay una cuenta con ese email.', 409);
  }
  if (text.includes('invalid') && text.includes('email')) {
    return new CommerceError('VALIDATION', 'Ese email no es válido.', 400);
  }
  return new CommerceError('INTERNAL', 'Supabase no aceptó el cambio de la cuenta.', 502);
}

/** Email with a link to choose a password (needs SMTP configured in Supabase Auth). */
export async function sendPasswordLink(service: SupabaseClient, email: string): Promise<boolean> {
  const next = encodeURIComponent('/es/cuenta/nueva-contrasena/');
  const { error } = await service.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl()}/api/auth/callback/?next=${next}`,
  });
  return !error;
}
