import { Resend } from 'resend';
import { emailFrom, hasResend } from '@/lib/server/env';

export type AuthEmail = 'verify' | 'reset' | 'magic';
type Locale = 'es' | 'en';

const COPY: Record<AuthEmail, Record<Locale, { subject: string; body: string }>> = {
  verify: {
    es: {
      subject: 'Confirma tu cuenta en Pets Drawings',
      body: 'Para terminar de crear tu cuenta, confirma tu correo con este enlace:',
    },
    en: {
      subject: 'Confirm your Pets Drawings account',
      body: 'To finish creating your account, confirm your email with this link:',
    },
  },
  reset: {
    es: {
      subject: 'Elige una contraseña nueva en Pets Drawings',
      body: 'Has pedido una contraseña nueva. Elígela con este enlace (caduca en una hora):',
    },
    en: {
      subject: 'Choose a new Pets Drawings password',
      body: 'You asked for a new password. Choose it with this link (it expires in an hour):',
    },
  },
  magic: {
    es: { subject: 'Entrar al estudio de Pets Drawings', body: 'Entra al panel con este enlace (caduca en 5 minutos):' },
    en: { subject: 'Sign in to the Pets Drawings studio', body: 'Sign in to the studio with this link (it expires in 5 minutes):' },
  },
};

export function renderAuthEmail(
  kind: AuthEmail,
  locale: Locale,
  { url, name }: { url: string; name: string },
): { subject: string; text: string } {
  const copy = COPY[kind][locale];
  const hello = locale === 'es' ? `Hola${name ? `, ${name}` : ''},` : `Hello${name ? `, ${name}` : ''},`;
  const ignore =
    locale === 'es'
      ? 'Si no lo has pedido tú, ignora este correo.'
      : 'If you did not ask for this, you can ignore this email.';
  return { subject: copy.subject, text: `${hello}\n\n${copy.body}\n\n${url}\n\n${ignore}\n\nPets Drawings` };
}

/** The visitor's language, from the page the link sends them to. */
export function localeOfUrl(url: string): Locale {
  return /callbackURL=%2Fen%2F|callbackURL=\/en\//.test(url) ? 'en' : 'es';
}

/** Sends at once (not through the outbox): links are short-lived. Throws MAIL_FAILED. */
export async function sendAuthEmail(
  kind: AuthEmail,
  to: string,
  { url, name }: { url: string; name: string },
): Promise<void> {
  if (!hasResend()) throw new Error('MAIL_FAILED: RESEND_API_KEY is not set');
  const { subject, text } = renderAuthEmail(kind, localeOfUrl(url), { url, name });
  const { error } = await new Resend(import.meta.env.RESEND_API_KEY).emails.send({ from: emailFrom(), to, subject, text });
  if (error) throw new Error(`MAIL_FAILED: ${error.message}`);
}
