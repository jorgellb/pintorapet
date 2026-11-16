/**
 * Login with Better Auth, on the same Aiven pool as the rest of the app.
 * Tables live in the `auth` schema (supabase/aiven/00_prelude.sql): user ids
 * are the ones Supabase Auth had, so customers and orders still point at them.
 * Its own endpoints (email links) are served at /api/session/*.
 */
import type { AstroCookies } from 'astro';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { hasDatabase, pool } from '@/lib/server/db';
import { siteUrl } from '@/lib/server/env';
import { forwardCookies } from './cookies';
import { sendAuthEmail } from './emails';
import { verifyPassword } from './password';

const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' };

function create() {
  return betterAuth({
    database: pool(),
    secret: import.meta.env.BETTER_AUTH_SECRET,
    baseURL: siteUrl(),
    basePath: '/api/session',
    trustedOrigins: [siteUrl()],
    telemetry: { enabled: false },
    user: {
      modelName: 'auth.users',
      fields: { emailVerified: 'email_verified', ...timestamps },
    },
    session: {
      modelName: 'auth.session',
      fields: { expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', userId: 'user_id', ...timestamps },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: {
      modelName: 'auth.account',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        ...timestamps,
      },
    },
    verification: {
      modelName: 'auth.verification',
      fields: { expiresAt: 'expires_at', ...timestamps },
    },
    // Routes here end in "/" (Astro trailingSlash: 'always'); without this Better Auth 404s them.
    advanced: { database: { generateId: 'uuid' }, skipTrailingSlashes: true },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 72,
      // Better Auth's scrypt for new passwords; the old Supabase bcrypt ones still work.
      password: { verify: (data) => verifyPassword(data) },
      resetPasswordTokenExpiresIn: 60 * 60,
      // A new password ends every session the old one had opened.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendAuthEmail('reset', user.email, { url, name: user.name }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => sendAuthEmail('verify', user.email, { url, name: user.name }),
    },
    plugins: [
      // The studio's "send me a link": only for accounts that already exist.
      magicLink({
        disableSignUp: true,
        expiresIn: 5 * 60,
        sendMagicLink: async ({ email, url }) => sendAuthEmail('magic', email, { url, name: '' }),
      }),
    ],
  });
}

let instance: ReturnType<typeof create> | undefined;

export function auth(): ReturnType<typeof create> {
  instance ??= create();
  return instance;
}

export function hasAuth(): boolean {
  return hasDatabase() && Boolean(import.meta.env.BETTER_AUTH_SECRET);
}

export type SessionUser = { id: string; email: string; name: string };

/** Who is signed in, if anyone. Refreshed session cookies are passed on. */
export async function sessionUser(cookies: AstroCookies, request: Request): Promise<SessionUser | null> {
  if (!hasAuth()) return null;
  try {
    const { headers, response } = await auth().api.getSession({ headers: request.headers, returnHeaders: true });
    forwardCookies(headers, cookies);
    if (!response?.user) return null;
    return { id: response.user.id, email: response.user.email, name: response.user.name };
  } catch {
    return null;
  }
}

/**
 * Sets a password for a signed-in user, as Supabase's updateUser did (no old
 * password asked), ends all their sessions, and signs this browser in again.
 */
export async function setOwnPassword(
  cookies: AstroCookies,
  request: Request,
  user: SessionUser,
  password: string,
): Promise<void> {
  const context = await auth().$context;
  const hash = await context.password.hash(password);
  // Someone who only ever signed in by link has no password account yet.
  if (await context.internalAdapter.findCredentialAccount(user.id)) {
    await context.internalAdapter.updatePassword(user.id, hash);
  } else {
    await context.internalAdapter.createAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash });
  }
  await context.internalAdapter.deleteUserSessions(user.id);
  await signInWithPassword(cookies, request, user.email, password);
}

/** Email + password sign-in; the session cookie goes out with the response. Throws Better Auth's APIError. */
export async function signInWithPassword(
  cookies: AstroCookies,
  request: Request,
  email: string,
  password: string,
): Promise<SessionUser> {
  const { headers, response } = await auth().api.signInEmail({
    body: { email, password },
    headers: request.headers,
    returnHeaders: true,
  });
  forwardCookies(headers, cookies);
  return { id: response.user.id, email: response.user.email, name: response.user.name };
}

/** Ends the session and clears its cookie; quiet when there was none. */
export async function signOut(cookies: AstroCookies, request: Request): Promise<void> {
  if (!hasAuth()) return;
  try {
    const { headers } = await auth().api.signOut({ headers: request.headers, returnHeaders: true });
    forwardCookies(headers, cookies);
  } catch {
    // No session to end.
  }
}
