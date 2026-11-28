import type { AstroCookies } from 'astro';
import { auth, sessionUser, type SessionUser } from '@/lib/server/auth';
import { forwardCookies } from '@/lib/server/auth/cookies';
import { db, userDb, type Db } from '@/lib/server/db';

/**
 * A signed-in admin. `db` runs as that user (role authenticated, auth.uid()),
 * like the Supabase client did, so admin_* functions and is_admin() policies
 * still check who is asking.
 */
export type AdminSession = { db: Db; user: SessionUser };

export function getSessionUser(cookies: AstroCookies, request: Request): Promise<SessionUser | null> {
  return sessionUser(cookies, request);
}

export async function isActiveAdmin(userId: string): Promise<boolean> {
  const row = await db()
    .one`select 1 as ok from public.admin_users where user_id = ${userId} and is_active`
    .catch(() => null);
  return Boolean(row);
}

export async function requireAdmin(cookies: AstroCookies, request: Request): Promise<AdminSession | null> {
  const user = await sessionUser(cookies, request);
  if (!user) return null;
  if (!(await isActiveAdmin(user.id))) return null;
  return { db: userDb(user.id), user };
}

/** Whether this email belongs to an active admin. */
export async function isActiveAdminEmail(email: string): Promise<boolean> {
  const row = await db()
    .one`
      select 1 as ok from public.admin_users a join auth.users u on u.id = a.user_id
      where lower(u.email) = ${email.trim().toLowerCase()} and a.is_active`
    .catch(() => null);
  return Boolean(row);
}

/**
 * The studio's sign-in. Only an active admin's password is ever checked: for
 * any other email the same hashing work is done and the answer is the same as a
 * wrong password, so this form cannot be used to test customers' passwords.
 */
export async function adminSignIn(
  cookies: AstroCookies,
  request: Request,
  email: string,
  password: string,
): Promise<'ok' | 'credentials'> {
  if (!(await isActiveAdminEmail(email))) {
    // What Better Auth does for an unknown email, so both take as long.
    await (await auth().$context).password.hash(password);
    return 'credentials';
  }
  let result;
  try {
    result = await auth().api.signInEmail({ body: { email, password }, headers: request.headers, returnHeaders: true });
  } catch {
    return 'credentials';
  }
  // Removed from the studio in the meantime: end the new session before it reaches the browser.
  if (!(await isActiveAdmin(result.response.user.id))) {
    const cookie = result.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
    await auth().api.signOut({ headers: new Headers({ cookie }) }).catch(() => undefined);
    return 'credentials';
  }
  forwardCookies(result.headers, cookies);
  return 'ok';
}

/**
 * Emails a short-lived sign-in link, only to an active admin (Better Auth
 * would send one to any address). Quiet either way; a failure is logged.
 */
export async function sendAdminLink(request: Request, email: string): Promise<void> {
  if (!(await isActiveAdminEmail(email))) return;
  try {
    await auth().api.signInMagicLink({ body: { email, callbackURL: '/admin/' }, headers: request.headers });
  } catch (err) {
    console.error('[admin login] sign-in link not sent', err instanceof Error ? err.message : err);
  }
}
