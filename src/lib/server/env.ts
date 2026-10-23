import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal(''));

export const publicEnvSchema = z.object({
  PUBLIC_SITE_URL: optionalUrl,
  PUBLIC_SUPABASE_URL: optionalUrl,
  PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

export function hasSupabase(): boolean {
  return Boolean(
    import.meta.env.PUBLIC_SUPABASE_URL &&
      import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** Service role required for privileged commerce RPCs. */
export function hasServiceSupabase(): boolean {
  return Boolean(
    import.meta.env.PUBLIC_SUPABASE_URL &&
      import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function hasResend(): boolean {
  return Boolean(import.meta.env.RESEND_API_KEY);
}

export function siteUrl(): string {
  return (
    import.meta.env.SITE_URL ||
    import.meta.env.PUBLIC_SITE_URL ||
    'http://localhost:4321'
  ).replace(/\/$/, '');
}

export function emailFrom(): string {
  return (
    import.meta.env.EMAIL_FROM || 'Pets Drawings <orders@petsdrawings.com>'
  );
}

export function emailAdmin(): string {
  return import.meta.env.EMAIL_ADMIN || 'info@petsdrawings.com';
}
