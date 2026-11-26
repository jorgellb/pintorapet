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
    line1: text(160).default(''),
    line2: text(160).default(''),
    city: text(100).default(''),
    state: text(100).default(''),
    postalCode: text(12).default(''),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase()),
    note: text(500).default(''),
    /**
     * A gift: the parcel goes to `name`; who sends it (`giftFrom`, the buyer)
     * and the message are printed on the packing slip.
     */
    gift: z.boolean().default(false),
    giftFrom: text(120).default(''),
    giftMessage: text(300).default(''),
    /** Picked up at a market (Admin › Mercados): no address to ship to. */
    pickup: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.pickup) return;
    if (!value.line1) ctx.addIssue({ code: 'custom', path: ['line1'], message: 'LINE1' });
    if (!value.city) ctx.addIssue({ code: 'custom', path: ['city'], message: 'CITY' });
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

/** Who buys: the gift's sender, or the person on the parcel. */
export function buyerName(customer: CheckoutCustomer): string {
  return (customer.gift && customer.giftFrom) || customer.name;
}

/** The address must be in the destination the shipping price was quoted for. */
export function destinationMatches(
  customer: CheckoutCustomer,
  quoted: { country: string | null; postalCode: string | null; pickupMarketId?: string | null },
): boolean {
  // A pickup quote is only for a pickup, and a pickup only for a pickup quote.
  if (Boolean(quoted.pickupMarketId) !== customer.pickup) return false;
  if (customer.pickup) return true;
  if (!quoted.country || customer.country !== quoted.country.toUpperCase()) return false;
  if (customer.country !== 'ES') return true;
  return customer.postalCode === (quoted.postalCode ?? '').trim();
}
