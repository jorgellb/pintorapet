import { z } from 'zod';
import { isValidSpanishTaxId, normalizeTaxId } from './taxId';
import { COUNTRIES_WITHOUT_POSTCODES, spanishProvince } from './address';

export { COUNTRIES_WITHOUT_POSTCODES, spanishProvince, suggestEmail } from './address';

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1);

export const checkoutCustomerSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    name: required(120),
    phone: required(32).refine((value) => value.replace(/\D/g, '').length >= 6, 'PHONE'),
    line1: required(160),
    line2: text(160).default(''),
    city: required(100),
    state: text(100).default(''),
    postalCode: text(12).default(''),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase()),
    note: text(500).default(''),
  })
  .strict()
  .superRefine((value, ctx) => {
    const needed = value.country === 'ES' || !COUNTRIES_WITHOUT_POSTCODES.includes(value.country);
    const ok =
      value.country === 'ES' ? /^\d{5}$/.test(value.postalCode) : !needed || value.postalCode.length > 0;
    if (!ok) ctx.addIssue({ code: 'custom', path: ['postalCode'], message: 'POSTAL_CODE' });
  });

export type CheckoutCustomer = z.infer<typeof checkoutCustomerSchema>;

export const invoiceCustomerSchema = z
  .object({
    taxId: z.string().transform(normalizeTaxId),
    name: required(160),
    address: required(200),
    postalCode: required(12),
    city: required(100),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase()),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ok =
      value.country === 'ES'
        ? isValidSpanishTaxId(value.taxId)
        : /^[A-Z0-9]{4,20}$/.test(value.taxId);
    if (!ok) ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'TAX_ID' });
  });

export type InvoiceCustomer = z.infer<typeof invoiceCustomerSchema>;

/** The address in the shape orders already store (the same one Stripe used to fill). */
export function shippingAddressFrom(customer: CheckoutCustomer) {
  return {
    name: customer.name,
    line1: customer.line1,
    line2: customer.line2,
    city: customer.city,
    state:
      customer.state || (customer.country === 'ES' ? (spanishProvince(customer.postalCode) ?? '') : ''),
    postal_code: customer.postalCode,
    country: customer.country,
    phone: customer.phone,
    note: customer.note,
  };
}

/** The address must be in the destination the shipping price was quoted for. */
export function destinationMatches(
  customer: CheckoutCustomer,
  quoted: { country: string | null; postalCode: string | null },
): boolean {
  if (!quoted.country || customer.country !== quoted.country.toUpperCase()) return false;
  if (customer.country !== 'ES') return true;
  return customer.postalCode === (quoted.postalCode ?? '').trim();
}
