import { waitUntil } from '@vercel/functions';
import type { AstroCookies } from 'astro';
import { adminSignIn, sendAdminLink } from '@/lib/server/adminAuth';
import { clientIp, formFields, inspect, reportSignedIn } from '@/lib/server/antibot';

export const ADMIN_LOGIN_TEXT = {
  email: 'Escribe un correo válido.',
  // A wrong password, an account that is not an admin and a bot all read this.
  failed: 'El correo o la contraseña no coinciden.',
  rate: 'Demasiados intentos. Espera un rato y vuelve a probar.',
  // Whether or not the email has access.
  link: 'Si ese correo tiene acceso, te llegará un enlace para entrar.',
} as const;

export type AdminLoginResult = { signedIn: true } | { signedIn: false; error?: string; notice?: string };

type Context = { cookies: AstroCookies; request: Request; clientAddress?: string };

/**
 * The studio's login form: with a password it signs in, without one it emails
 * a sign-in link. Both go through the anti-bot gate and its limits first, like
 * the customers' forms: signing in counts as a sign-in, a link as a password
 * reset (an email to that inbox).
 */
export async function adminLogin(context: Context, form: FormData): Promise<AdminLoginResult> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  // Passwords are at most 72 characters; a longer post is not hashed whole.
  const password = String(form.get('password') ?? '').slice(0, 128);
  // Typos do not count towards the limits: check the field first.
  if (!email.includes('@')) return { signedIn: false, error: ADMIN_LOGIN_TEXT.email };

  const fields = formFields(form);
  const wantsLink = password.length === 0;
  const { verdict } = await inspect({
    form: 'sign_in',
    ...(wantsLink && { countAs: 'forgot' as const }),
    fields,
    ip: clientIp(context),
    email,
  });
  if (verdict === 'rate') return { signedIn: false, error: ADMIN_LOGIN_TEXT.rate };

  if (wantsLink) {
    // Bots get the answer a person would get, and no email goes out. The email
    // is sent after the answer, so an admin's address does not answer slower.
    if (verdict === 'allow') waitUntil(sendAdminLink(context.request, email));
    return { signedIn: false, notice: ADMIN_LOGIN_TEXT.link };
  }

  if (verdict === 'block') return { signedIn: false, error: ADMIN_LOGIN_TEXT.failed };
  if ((await adminSignIn(context.cookies, context.request, email, password)) !== 'ok') {
    return { signedIn: false, error: ADMIN_LOGIN_TEXT.failed };
  }
  await reportSignedIn(fields);
  return { signedIn: true };
}
