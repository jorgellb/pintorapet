import type { APIRoute } from 'astro';
import { localizedPath, type Locale } from '@/i18n/routes';
import { passwordSchema, safeNext } from '@/lib/domain/accountProfile';
import { authErrorKey } from '@/lib/server/account';
import { setFlash } from '@/lib/server/flash';
import { createUserServerClient } from '@/lib/server/supabase';

export const prerender = false;

const PAGES = {
  'sign-in': 'accountSignIn',
  register: 'accountRegister',
  forgot: 'accountForgot',
  reset: 'accountReset',
} as const;

/**
 * Sign in, register, ask for a password link and set a new password. Each form
 * posts here; the answer is a redirect, with any message in a one-time cookie.
 */
export const POST: APIRoute = async ({ params, request, cookies, redirect, url }) => {
  const action = params.action as keyof typeof PAGES;
  if (!(action in PAGES)) return new Response(null, { status: 404 });

  const form = await request.formData();
  const locale: Locale = form.get('locale') === 'en' ? 'en' : 'es';
  const account = localizedPath(locale, 'account');
  const page = localizedPath(locale, PAGES[action]);
  const next = safeNext(String(form.get('next') ?? ''), account);
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const fullName = String(form.get('full_name') ?? '').trim().slice(0, 120);
  const password = String(form.get('password') ?? '');
  const back = (error: string) => {
    setFlash(cookies, { error, email, fullName });
    const query = next !== account ? `?next=${encodeURIComponent(next)}` : '';
    return redirect(`${page}${query}`, 303);
  };
  const callback = (to: string) => `${url.origin}/api/auth/callback/?next=${encodeURIComponent(to)}`;

  const client = createUserServerClient(cookies, request);
  if (!client) return back('generic');

  if (action === 'sign-in') {
    const { error } = await client.auth.signInWithPassword({ email, password });
    return error ? back(authErrorKey(error.message)) : redirect(next, 303);
  }

  if (action === 'register') {
    if (form.get('privacy') !== 'yes') return back('privacy');
    if (fullName.length < 2 || !email.includes('@')) return back('missing');
    if (!passwordSchema.safeParse(password).success) return back('weak');
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: callback(account) },
    });
    if (error) return back(authErrorKey(error.message));
    if (data.session) return redirect(next, 303);
    setFlash(cookies, { sent: 'register', email });
    return redirect(page, 303);
  }

  if (action === 'forgot') {
    if (!email.includes('@')) return back('missing');
    // The same answer whether or not the account exists.
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: callback(localizedPath(locale, 'accountReset')),
    });
    if (error && authErrorKey(error.message) === 'rate') return back('rate');
    setFlash(cookies, { sent: 'forgot', email });
    return redirect(page, 303);
  }

  // reset: needs the session the password link opened
  const { data: who } = await client.auth.getUser();
  if (!who.user) return back('link');
  if (password !== String(form.get('password_repeat') ?? '')) return back('mismatch');
  if (!passwordSchema.safeParse(password).success) return back('weak');
  const { error } = await client.auth.updateUser({ password });
  return error ? back(authErrorKey(error.message)) : redirect(`${account}?password=1`, 303);
};
