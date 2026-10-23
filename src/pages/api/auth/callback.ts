import type { APIRoute } from 'astro';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeNext } from '@/lib/domain/accountProfile';
import { localizedPath } from '@/i18n/routes';
import { createUserServerClient } from '@/lib/server/supabase';

export const prerender = false;

const OTP_TYPES: EmailOtpType[] = ['signup', 'recovery', 'email', 'email_change', 'invite', 'magiclink'];

/**
 * Links in the confirmation and password emails land here. A `code` (PKCE) or a
 * `token_hash` becomes a session cookie, then the visitor goes on to `next`.
 */
export const GET: APIRoute = async ({ url, cookies, request, redirect }) => {
  const locale = url.searchParams.get('next')?.startsWith('/en/') ? 'en' : 'es';
  const signIn = localizedPath(locale, 'accountSignIn');
  const next = safeNext(url.searchParams.get('next'), localizedPath(locale, 'account'));
  const client = createUserServerClient(cookies, request);
  if (!client) return redirect(`${signIn}?error=link`, 303);

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  const { error } = code
    ? await client.auth.exchangeCodeForSession(code)
    : tokenHash && type && OTP_TYPES.includes(type)
      ? await client.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error('missing code') };

  if (error) return redirect(`${signIn}?error=link`, 303);
  return redirect(next, 303);
};
