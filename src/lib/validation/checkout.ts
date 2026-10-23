import { z } from 'zod';
import { cartItemSchema } from '@/lib/domain/cart';
import { checkoutCustomerSchema, invoiceCustomerSchema } from '@/lib/domain/checkoutCustomer';

/** Strict bodies reject client-supplied prices and unknown keys. */
export const quoteRequestSchema = z
  .object({
    locale: z.enum(['en', 'es']),
    items: z.array(cartItemSchema).min(1).max(20),
    shippingCountry: z.string().regex(/^[A-Za-z]{2}$/).optional(),
    shippingPostalCode: z.string().trim().max(12).optional(),
    /** Present when the customer asks for a full invoice with their tax id. */
    invoice: invoiceCustomerSchema.optional(),
  })
  .strict();

export const shippingEstimateSchema = z
  .object({
    locale: z.enum(['en', 'es']),
    items: z.array(cartItemSchema).min(1).max(20),
    country: z.string().regex(/^[A-Za-z]{2}$/),
    postalCode: z.string().trim().max(12).optional(),
  })
  .strict();

export const checkoutCreateSchema = z
  .object({
    quoteId: z.string().min(1).max(128),
    attemptId: z.string().uuid(),
    locale: z.enum(['en', 'es']),
    provider: z.enum(['stripe', 'paypal']).default('stripe'),
    items: z.array(cartItemSchema).min(1).max(20).optional(),
    /** Contact and shipping details from the checkout form. */
    customer: checkoutCustomerSchema.optional(),
    /** Signed-in customers can keep these details in their profile. */
    saveToProfile: z.boolean().optional(),
  })
  .strict();

export const contactSchema = z
  .object({
    locale: z.enum(['en', 'es']),
    name: z.string().trim().min(1).max(120),
    email: z.string().email().max(254),
    reason: z.string().trim().min(1).max(120).optional(),
    message: z.string().trim().min(1).max(5000),
  })
  .strict();

export const commissionSchema = z
  .object({
    locale: z.enum(['en', 'es']),
    name: z.string().trim().min(1).max(120),
    email: z.string().email().max(254),
    size: z.enum(['A4', 'A3', 'undecided']).default('undecided'),
    subjects: z.number().int().min(1).max(10).default(1),
    message: z.string().trim().min(1).max(5000),
  })
  .strict();
