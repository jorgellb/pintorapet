import type { APIRoute } from 'astro';
import { checkoutPaths } from '@/lib/server/commerce/checkout';
import { cancelPaypalOrder } from '@/lib/server/commerce/paypalCheckout';
import { serviceDb } from '@/lib/server/db';
import { loadPaymentConfig } from '@/lib/server/payments/config';

export const prerender = false;

export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token');
  const supabase = serviceDb();
  let locale: 'en' | 'es' = 'es';
  if (token && supabase) {
    const { paypal } = await loadPaymentConfig().catch(() => ({ paypal: null }));
    const result = await cancelPaypalOrder(supabase, paypal, token).catch(() => ({ locale: undefined }));
    locale = result.locale ?? locale;
  }
  return redirect(checkoutPaths(locale).cancel, 303);
};
