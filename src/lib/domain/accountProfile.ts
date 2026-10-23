import { z } from 'zod';
import { COUNTRIES_WITHOUT_POSTCODES } from './address';
import { invoiceCustomerSchema } from './checkoutCustomer';

const text = (max: number) => z.string().trim().max(max);

const countryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toUpperCase());

/** Delivery address kept in the profile; every part is optional until the first line is given. */
export const profileAddressSchema = z
  .object({
    line1: text(160).min(3),
    line2: text(160).default(''),
    city: text(100).min(2),
    state: text(100).default(''),
    postal_code: text(12).default(''),
    country: countryCode,
  })
  .strict()
  .superRefine((value, ctx) => {
    const ok =
      value.country === 'ES'
        ? /^\d{5}$/.test(value.postal_code)
        : COUNTRIES_WITHOUT_POSTCODES.includes(value.country) || value.postal_code.length > 0;
    if (!ok) ctx.addIssue({ code: 'custom', path: ['postal_code'], message: 'POSTAL_CODE' });
  });

export const accountProfileSchema = z
  .object({
    full_name: text(120).min(2),
    phone: text(32).refine((value) => value === '' || value.replace(/\D/g, '').length >= 6, 'PHONE'),
    address: profileAddressSchema.nullable(),
    billing: invoiceCustomerSchema.nullable(),
  })
  .strict();

export type AccountProfile = z.infer<typeof accountProfileSchema>;

export const passwordSchema = z.string().min(8).max(72);

/**
 * Where to go after signing in: only paths on this site. The value is parsed as
 * a URL (browsers drop tabs and newlines, and read backslashes as slashes), so
 * tricks like "/\t/evil.example" cannot leave the site.
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/') || /[\u0000-\u001F\u007F\\]/.test(next)) return fallback;
  // No empty or dot segments: normalising "/.//x" would turn it into "//x".
  const path = next.split(/[?#]/)[0];
  if (path.includes('//') || /\/\.{1,2}(\/|$)/.test(path)) return fallback;
  const base = 'https://petsdrawings.invalid';
  try {
    const url = new URL(next, base);
    const result = `${url.pathname}${url.search}${url.hash}`;
    // Check what is returned, not only what was parsed.
    if (url.origin !== base || result.startsWith('//') || result.startsWith('/\\')) return fallback;
    return result;
  } catch {
    return fallback;
  }
}
