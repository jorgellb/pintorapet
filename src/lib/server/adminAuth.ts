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

/**
 * The studio's sign-in: the session cookie only goes out for an active admin.
 * Anyone else's new session is ended at once, so it never reaches the browser.
 */
export async function adminSignIn(
  cookies: AstroCookies,
  request: Request,
  email: string,
  password: string,
): Promise<'ok' | 'credentials' | 'not_admin'> {
  let result;
  try {
    result = await auth().api.signInEmail({ body: { email, password }, headers: request.headers, returnHeaders: true });
  } catch {
    return 'credentials';
  }
  if (!(await isActiveAdmin(result.response.user.id))) {
    const cookie = result.headers.getSetCookie().map((header) => header.split(';')[0]).join('; ');
    await auth().api.signOut({ headers: new Headers({ cookie }) }).catch(() => undefined);
    return 'not_admin';
  }
  forwardCookies(result.headers, cookies);
  return 'ok';
}

/** Emails a short-lived sign-in link to an existing account (none is created). */
export async function sendAdminLink(request: Request, email: string): Promise<boolean> {
  try {
    await auth().api.signInMagicLink({ body: { email, callbackURL: '/admin/' }, headers: request.headers });
    return true;
  } catch {
    return false;
  }
}
