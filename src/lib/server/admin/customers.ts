import { z } from 'zod';
import { db, sql, transaction, upsert, type Db } from '@/lib/server/db';
import { accountProfileSchema, type AccountProfile } from '@/lib/domain/accountProfile';
import { auth } from '@/lib/server/auth';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { deleteReview, forgetReviews } from '@/lib/server/reviews/store';
export { GUEST_KEY, guestKey } from './guestKey';
import { guestKey } from './guestKey';

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
  /** Guests only: the key of their record (public.guest_key of their email). */
  key?: string;
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

/** A new email also ends the account's sessions: whoever was signed in signs in again. */
export async function changeAccountEmail(service: Db, id: string, email: string): Promise<void> {
  await service.run`update auth.users set email = ${email}, email_verified = true, updated_at = now() where id = ${id}`.catch(
    (err: unknown) => {
      throw authAdminError(err);
    },
  );
  await service.run`delete from auth.session where user_id = ${id}`;
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

// ——— Customers without an account (guests) ———
// Their data lives in their orders; every function below is service role only
// in SQL, so the routes that call these use serviceDb() behind requireAdmin().

export type AdminGuestDetail = {
  key: string;
  email: string;
  full_name: string;
  phone: string;
  orders: Array<{
    id: string;
    reference: string;
    created_at: string;
    payment_status: string;
    fulfillment_status: string;
    total_cents: number;
  }>;
  spent_cents: number;
  contact_messages: number;
  commission_requests: number;
};

/** What the admin edits of a guest. `confirmMerge`: yes, join the other guest with that email. */
export const adminGuestSchema = z
  .object({
    full_name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    phone: z.string().trim().max(32).default(''),
    confirmMerge: z.boolean().optional(),
  })
  .strict();
export type AdminGuestInput = z.infer<typeof adminGuestSchema>;

export type AnonymizeResult = { orders: number; warning?: string };

export async function getGuest(service: Db, key: string): Promise<AdminGuestDetail | null> {
  return (await dbCall(() => service.call<AdminGuestDetail | null>('admin_guest_customer', { p_key: key }))) ?? null;
}

/**
 * Change a guest's name, email and phone on every one of their orders. An email
 * that already belongs to another guest would join the two; that is asked first
 * (a 409 with `details.merge`) and goes ahead with `confirmMerge`.
 */
export async function updateGuest(
  service: Db,
  key: string,
  input: AdminGuestInput,
): Promise<{ key: string; merged: boolean; orders: number; phoneSkipped: number }> {
  const newKey = guestKey(input.email);
  if (newKey !== key && !input.confirmMerge) {
    const other = await getGuest(service, newKey);
    if (other) {
      const count = other.orders.length;
      throw new CommerceError(
        'CONFLICT',
        `Ya hay otro cliente sin cuenta con ese email (${count} ${count === 1 ? 'pedido' : 'pedidos'}). Si sigues, sus pedidos pasarán a formar una sola ficha.`,
        409,
        { merge: true },
      );
    }
  }
  const saved = await dbCall(() =>
    service.call<{ key: string; merged: boolean; orders: number; phone_skipped: number }>('admin_guest_update', {
      p_key: key,
      p_full_name: input.full_name,
      p_email: input.email,
      p_phone: input.phone,
    }),
  );
  // Orders with no address have nowhere to keep a phone: the page says so.
  return { key: saved.key, merged: saved.merged, orders: saved.orders, phoneSkipped: saved.phone_skipped ?? 0 };
}

/**
 * The reviews of anonymized orders go with their photos (Cloudinary last, after
 * the data is already anonymized in the database). A photo that cannot be destroyed
 * leaves the review hidden from the web; that is a warning, never an error: the
 * personal data is gone either way. A review that is already gone is fine.
 */
async function eraseReviews(reviewIds: string[]): Promise<string | undefined> {
  let failed = 0;
  for (const id of reviewIds) {
    try {
      await deleteReview(db(), id);
    } catch (err) {
      if (err instanceof CommerceError && err.status === 404) continue;
      failed += 1;
      console.error('[customers] review of an anonymized order not deleted', id, err instanceof Error ? err.message : err);
    }
  }
  forgetReviews();
  if (failed === 0) return undefined;
  return `Los datos están borrados, pero no se pudieron quitar de Cloudinary las fotos de ${failed} ${failed === 1 ? 'opinión' : 'opiniones'}. Ya no se ven en la web: bórralas en Opiniones.`;
}

async function finish(done: { orders: number; review_ids: string[] }): Promise<AnonymizeResult> {
  const warning = await eraseReviews(done.review_ids ?? []);
  return { orders: done.orders, ...(warning ? { warning } : {}) };
}

/** Anonymize a guest's orders (refused while one is still due), then their reviews. */
export async function anonymizeGuest(service: Db, key: string): Promise<AnonymizeResult> {
  const done = await dbCall(() =>
    service.call<{ orders: number; review_ids: string[] }>('admin_guest_anonymize', { p_key: key }),
  );
  return finish(done);
}

/**
 * Delete an account and anonymize its orders (the ones of the account and the ones
 * placed with its email) in ONE transaction: the order ids are read first (deleting
 * the account unlinks them), the account is deleted, and anonymize_orders refuses
 * (a 409 naming the orders) while one is due, unfinished or without its invoice,
 * which rolls the account delete back too. Only the review photos, in Cloudinary,
 * are deleted after the commit; a failure there is a warning.
 */
export async function anonymizeAccountOrders(userId: string): Promise<AnonymizeResult> {
  const done = await dbCall(() =>
    transaction(async (tx) => {
      const email = await accountEmail(tx, userId);
      if (email === null) throw new CommerceError('UNAVAILABLE', 'Ese cliente ya no existe.', 404);
      const ids = (await tx.call<string[] | null>('admin_account_order_ids', { p_user_id: userId })) ?? [];
      await deleteAccount(tx, userId);
      const row = await tx.one<{ result: { orders: number; review_ids: string[] } }>(
        sql`select public.anonymize_orders(${ids}::uuid[], ${email}) as result`,
      );
      return row!.result;
    }),
  );
  return finish(done);
}

/** What exists with this email in Contacto and Encargos: neither can be deleted from Admin. */
export async function emailTraces(service: Db, email: string): Promise<{ contact_messages: number; commission_requests: number }> {
  const row = await service.one<{ contact_messages: number; commission_requests: number }>(sql`
    select (select count(*) from public.contact_messages where public.guest_key(contact_email) = public.guest_key(${email}))::int as contact_messages,
           (select count(*) from public.commission_requests where public.guest_key(contact_email) = public.guest_key(${email}))::int as commission_requests`);
  return row ?? { contact_messages: 0, commission_requests: 0 };
}
