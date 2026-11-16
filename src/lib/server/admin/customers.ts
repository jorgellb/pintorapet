import { z } from 'zod';
import { upsert, type Db } from '@/lib/server/db';
import { accountProfileSchema, type AccountProfile } from '@/lib/domain/accountProfile';
import { auth } from '@/lib/server/auth';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';

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

export async function listCustomers(client: Db): Promise<AdminCustomerRow[]> {
  return (await dbCall(() => client.call<AdminCustomerRow[] | null>('admin_customers'))) ?? [];
}

export async function getCustomer(client: Db, id: string): Promise<AdminCustomerDetail | null> {
  return client.call<AdminCustomerDetail | null>('admin_customer', { p_id: id }).catch(() => null);
}

/** True when the account belongs to the admin team (active or not). */
export async function isAdminAccount(service: Db, id: string): Promise<boolean> {
  const row = await service.one`select user_id from public.admin_users where user_id = ${id}`.catch(() => {
    throw new CommerceError('INTERNAL', 'No se pudo comprobar la cuenta.', 500);
  });
  return Boolean(row);
}

/**
 * Other admins' accounts are not managed from Clientes: changing their email or
 * mailing them a password link would hand their access to someone else.
 */
export async function assertManageable(service: Db, id: string, selfId: string): Promise<void> {
  if (id !== selfId && (await isAdminAccount(service, id))) {
    throw new CommerceError('FORBIDDEN', 'Es otra cuenta de administración: no se cambia desde Clientes.', 403);
  }
}

/** Translate account errors (a taken email, a bad one) into messages for the panel. */
export function authAdminError(err: unknown): CommerceError {
  const text = String(err && typeof err === 'object' && 'message' in err ? (err as { message: unknown }).message : err).toLowerCase();
  if (text.includes('users_email_key') || (text.includes('already') && (text.includes('registered') || text.includes('exists')))) {
    return new CommerceError('CONFLICT', 'Ya hay una cuenta con ese email.', 409);
  }
  if (text.includes('invalid') && text.includes('email')) {
    return new CommerceError('VALIDATION', 'Ese email no es válido.', 400);
  }
  return new CommerceError('INTERNAL', 'No se pudo cambiar la cuenta.', 500);
}

export async function accountEmail(service: Db, id: string): Promise<string | null> {
  const row = await service.one<{ email: string }>`select email from auth.users where id = ${id}`;
  return row?.email ?? null;
}

/** A confirmed account with no password yet: they choose one from the password link. */
export async function createAccount(service: Db, email: string, fullName: string): Promise<string> {
  const row = await service
    .one<{ id: string }>`insert into auth.users (email, name, email_verified) values (${email}, ${fullName}, true) returning id`
    .catch((err: unknown) => {
      throw authAdminError(err);
    });
  return row!.id;
}

export async function changeAccountEmail(service: Db, id: string, email: string): Promise<void> {
  await service.run`update auth.users set email = ${email}, email_verified = true, updated_at = now() where id = ${id}`.catch(
    (err: unknown) => {
      throw authAdminError(err);
    },
  );
}

/** Its sessions and password go with it; orders stay and just lose the link to the account. */
export async function deleteAccount(service: Db, id: string): Promise<void> {
  await service.run`delete from auth.users where id = ${id}`.catch((err: unknown) => {
    throw authAdminError(err);
  });
}

export async function saveCustomerProfile(service: Db, id: string, profile: AccountProfile): Promise<void> {
  await service
    .run(
      upsert(
        'customers',
        { id, full_name: profile.full_name, phone: profile.phone, address: profile.address, billing: profile.billing },
        ['id'],
      ),
    )
    .catch(() => {
      throw new CommerceError('INTERNAL', 'No se pudo guardar la ficha del cliente.', 500);
    });
}

/** Email with a link to choose a password (Better Auth, sent through Resend). */
export async function sendPasswordLink(email: string): Promise<boolean> {
  try {
    await auth().api.requestPasswordReset({ body: { email, redirectTo: '/es/cuenta/nueva-contrasena/' } });
    return true;
  } catch {
    return false;
  }
}
