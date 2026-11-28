import type { APIRoute } from 'astro';
import { localizedPath, type Locale } from '@/i18n/routes';
import { passwordSchema, safeNext } from '@/lib/domain/accountProfile';
import { authErrorKey } from '@/lib/server/account';
import { clientIp, formFields, inspect, reportSignedIn, type AntibotForm } from '@/lib/server/antibot';
import { setFlash } from '@/lib/server/flash';
import {
  auth,
  hasAuth,
  hasOwnPassword,
  sessionUser,
  setOwnPassword,
  signInWithPassword,
  WrongCurrentPassword,
} from '@/lib/server/auth';
import { forwardCookies } from '@/lib/server/auth/cookies';
import { db } from '@/lib/server/db';

export const prerender = false;

const PAGES = {
  'sign-in': 'accountSignIn',
  register: 'accountRegister',
  forgot: 'accountForgot',
  reset: 'accountReset',
} as const;

const GATED: Partial<Record<keyof typeof PAGES, AntibotForm>> = {
  'sign-in': 'sign_in',
  register: 'register',
  forgot: 'forgot',
};

/**
 * Sign in, register, ask for a password link and set a new password. Each form
 * posts here; the answer is a redirect, with any message in a one-time cookie.
 */
export const POST: APIRoute = async (context) => {
  const { params, request, cookies, redirect } = context;
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
  const token = action === 'reset' ? String(form.get('token') ?? '') : '';
  const back = (error: string) => {
    setFlash(cookies, { error, email, fullName });
    const query = new URLSearchParams();
    if (next !== account) query.set('next', next);
    // A new-password form keeps its link while the customer fixes a typo.
    if (token && error !== 'link') query.set('token', token);
    const search = query.toString();
    return redirect(`${page}${search ? `?${search}` : ''}`, 303);
  };

  // Typos do not count towards the limits: check the fields first.
  if (action === 'register') {
    if (form.get('privacy') !== 'yes') return back('privacy');
    if (fullName.length < 2 || !email.includes('@')) return back('missing');
    if (!passwordSchema.safeParse(password).success) return back('weak');
  }
  if (action === 'forgot' && !email.includes('@')) return back('missing');

  const gated = GATED[action];
  if (gated) {
    const { verdict } = await inspect({ form: gated, fields: formFields(form), ip: clientIp(context), email, name: fullName });
    if (verdict === 'rate') return back('rate');
    if (verdict === 'block') {
      // Bots get the answer a person would get, so they learn nothing.
      if (action === 'sign-in') return back('generic');
      setFlash(cookies, { sent: action === 'register' ? 'register' : 'forgot', email });
      return redirect(page, 303);
    }
  }

  if (!hasAuth()) return back('generic');

  if (action === 'sign-in') {
    try {
      await signInWithPassword(cookies, request, email, password);
    } catch (err) {
      return back(authErrorKey(err));
    }
    await reportSignedIn(formFields(form));
    return redirect(next, 303);
  }

  if (action === 'register') {
    try {
      // The confirmation link comes back to the account page, signed in.
      const { headers, response } = await auth().api.signUpEmail({
        body: { email, password, name: fullName, callbackURL: account },
        headers: request.headers,
        returnHeaders: true,
      });
      if (response.token) {
        forwardCookies(headers, cookies);
        return redirect(next, 303);
      }
    } catch (err) {
      return back(authErrorKey(err));
    }
    setFlash(cookies, { sent: 'register', email });
    return redirect(page, 303);
  }

  if (action === 'forgot') {
    // The same answer whether or not the account exists.
    try {
      await auth().api.requestPasswordReset({ body: { email, redirectTo: localizedPath(locale, 'accountReset') } });
    } catch (err) {
      if (authErrorKey(err) === 'rate') return back('rate');
    }
    setFlash(cookies, { sent: 'forgot', email });
    return redirect(page, 303);
  }

  // reset: from the emailed link (token) or from the account page while signed in
  if (password !== String(form.get('password_repeat') ?? '')) return back('mismatch');
  if (!passwordSchema.safeParse(password).success) return back('weak');
  if (token) {
    const owner = await db()
      .one<{ email: string }>`
        select u.email from auth.verification v join auth.users u on u.id::text = v.value
        where v.identifier = ${`reset-password:${token}`} and v.expires_at > now()`
      .catch(() => null);
    if (!owner) return back('link');
    try {
      await auth().api.resetPassword({ body: { newPassword: password, token } });
      // Signed in straight away, as the Supabase link did.
      await signInWithPassword(cookies, request, owner.email, password);
    } catch (err) {
      return back(authErrorKey(err) === 'weak' ? 'weak' : 'link');
    }
    return redirect(`${account}?password=1`, 303);
  }
  const who = await sessionUser(cookies, request);
  if (!who) return back('link');
  // Guessing the current password is limited like signing in.
  const guarded = await hasOwnPassword(who.id).catch(() => true);
  if (guarded) {
    const { verdict } = await inspect({ form: 'sign_in', fields: formFields(form), ip: clientIp(context), email: who.email });
    if (verdict === 'rate') return back('rate');
    if (verdict === 'block') return back('generic');
  }
  try {
    await setOwnPassword(cookies, request, who, password, String(form.get('current_password') ?? ''));
  } catch (err) {
    return back(err instanceof WrongCurrentPassword ? 'current' : authErrorKey(err));
  }
  if (guarded) await reportSignedIn(formFields(form));
  return redirect(`${account}?password=1`, 303);
};
