import type { APIRoute } from 'astro';
import { checkoutPaths } from '@/lib/server/commerce/checkout';
import { cancelPaypalOrder } from '@/lib/server/commerce/paypalCheckout';
import { serviceDb } from '@/lib/server/db';

export const prerender = false;

export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token');
  const supabase = serviceDb();
  let locale: 'en' | 'es' = 'es';
  if (token && supabase) {
    const result = await cancelPaypalOrder(supabase, token).catch(() => ({ locale: undefined }));
    locale = result.locale ?? locale;
  }
  return redirect(checkoutPaths(locale).cancel, 303);
};
