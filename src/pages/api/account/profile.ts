import type { APIRoute } from 'astro';
import { localizedPath, type Locale } from '@/i18n/routes';
import { accountProfileSchema } from '@/lib/domain/accountProfile';
import { customerSession, saveProfile } from '@/lib/server/account';
import { setFlash } from '@/lib/server/flash';

export const prerender = false;

/** Saves the "Your details" form, then back to the account with a message. */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const locale: Locale = form.get('locale') === 'en' ? 'en' : 'es';
  const session = await customerSession(cookies, request);
  if (!session) return redirect(localizedPath(locale, 'accountSignIn'), 303);

  const get = (name: string) => String(form.get(name) ?? '').trim();
  const hasAddress = get('line1') !== '' || get('city') !== '';
  const draft = {
    full_name: get('full_name'),
    phone: get('phone'),
    address: hasAddress
      ? {
          line1: get('line1'),
          line2: get('line2'),
          city: get('city'),
          state: get('state'),
          postal_code: get('postal_code'),
          country: get('country') || 'ES',
        }
      : null,
    billing:
      form.get('wants_billing') === 'yes'
        ? {
            taxId: get('tax_id'),
            name: get('billing_name'),
            address: get('billing_address'),
            postalCode: get('billing_postal'),
            city: get('billing_city'),
            country: get('billing_country') || 'ES',
          }
        : null,
  };

  const parsed = accountProfileSchema.safeParse(draft);
  if (parsed.success && (await saveProfile(session, parsed.data))) {
    return redirect(`${localizedPath(locale, 'account')}?saved=1`, 303);
  }
  const fields = parsed.success
    ? ['full_name']
    : [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  // The draft travels back so nothing typed is lost.
  setFlash(cookies, { error: fields.join(','), draft: JSON.stringify(draft) });
  return redirect(localizedPath(locale, 'accountDetails'), 303);
};
