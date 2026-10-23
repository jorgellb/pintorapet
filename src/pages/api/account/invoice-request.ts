import type { APIRoute } from 'astro';
import { localizedPath, type Locale } from '@/i18n/routes';
import { invoiceCustomerSchema } from '@/lib/domain/checkoutCustomer';
import { customerSession, loadProfile, saveProfile } from '@/lib/server/account';
import { setFlash } from '@/lib/server/flash';

export const prerender = false;

/** "I need an invoice with my tax ID" from an order in the customer's account. */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const locale: Locale = form.get('locale') === 'en' ? 'en' : 'es';
  const reference = String(form.get('reference') ?? '').trim().slice(0, 40);
  const back = localizedPath(locale, 'accountOrder', reference);
  const session = await customerSession(cookies, request);
  if (!session) return redirect(localizedPath(locale, 'accountSignIn'), 303);

  const get = (name: string) => String(form.get(name) ?? '').trim();
  const draft = {
    taxId: get('tax_id'),
    name: get('billing_name'),
    address: get('billing_address'),
    postalCode: get('billing_postal'),
    city: get('billing_city'),
    country: get('billing_country') || 'ES',
  };
  const parsed = invoiceCustomerSchema.safeParse(draft);
  if (!parsed.success) {
    setFlash(cookies, { error: 'invoice_fields', draft: JSON.stringify(draft) });
    return redirect(`${back}#invoice`, 303);
  }

  const { data, error } = await session.client.rpc('request_full_invoice', {
    p_reference: reference,
    p_customer: parsed.data,
  });
  if (error) {
    const code = String(error.message ?? '');
    setFlash(cookies, {
      error: code.includes('INVALID_TAX_ID')
        ? 'invoice_fields'
        : code.includes('INVOICE_CONFIG_INCOMPLETE')
          ? 'invoice_later'
          : 'invoice_failed',
      draft: JSON.stringify(draft),
    });
    return redirect(`${back}#invoice`, 303);
  }

  if (form.get('save_billing') === 'yes') {
    const profile = await loadProfile(session).catch(() => null);
    if (profile) await saveProfile(session, { ...profile, billing: parsed.data }).catch(() => false);
  }
  const status = (data as { status?: string } | null)?.status ?? 'issued';
  return redirect(`${back}?invoice=${status}#invoice`, 303);
};
