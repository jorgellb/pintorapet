import type { APIRoute } from 'astro';
import { localizedPath } from '@/i18n/routes';
import { createUserServerClient } from '@/lib/server/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, request, redirect }) => {
  const form = await request.formData().catch(() => null);
  const locale = form?.get('locale') === 'en' ? 'en' : 'es';
  await createUserServerClient(cookies, request)?.auth.signOut();
  return redirect(localizedPath(locale, 'home'), 303);
};
