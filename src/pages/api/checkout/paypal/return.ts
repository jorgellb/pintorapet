import type { APIRoute } from 'astro';
import { checkoutPaths } from '@/lib/server/commerce/checkout';
import { finalizePaypalOrder } from '@/lib/server/commerce/paypalCheckout';
import { loadPaymentConfig } from '@/lib/server/payments/config';
import { createServiceClient } from '@/lib/server/supabase';

export const prerender = false;

/** PayPal sends the buyer here after approving: `?token=<paypal order id>&PayerID=…`. */
export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token');
  const { paypal } = await loadPaymentConfig();
  const supabase = createServiceClient();
  if (!token || !paypal || !supabase) return redirect(checkoutPaths('es').cancel, 303);

  try {
    const outcome = await finalizePaypalOrder(supabase, paypal, token);
    const paths = checkoutPaths(outcome.locale ?? 'es');
    if (outcome.status === 'not_found') return redirect(paths.cancel, 303);
    if (outcome.status === 'expired') return redirect(`${paths.cancel}?motivo=caducado`, 303);
    const query = new URLSearchParams({ ref: outcome.reference ?? '', provider: 'paypal' });
    return redirect(`${paths.success}?${query}`, 303);
  } catch {
    return redirect(`${checkoutPaths('es').cancel}?motivo=error`, 303);
  }
};
