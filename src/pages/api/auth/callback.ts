import type { APIRoute } from 'astro';
import { safeNext } from '@/lib/domain/accountProfile';
import { localizedPath } from '@/i18n/routes';

export const prerender = false;

/**
 * Old Supabase email links landed here. Links now go to Better Auth
 * (/api/session/*), which signs the visitor in and sends them on; an old link
 * just leads to the sign-in page with "the link has expired".
 */
export const GET: APIRoute = ({ url, redirect }) => {
  const locale = url.searchParams.get('next')?.startsWith('/en/') ? 'en' : 'es';
  const signIn = localizedPath(locale, 'accountSignIn');
  const next = safeNext(url.searchParams.get('next'), localizedPath(locale, 'account'));
  return redirect(`${signIn}?error=link&next=${encodeURIComponent(next)}`, 303);
};
