import type { Locale } from '@/i18n/routes';

/**
 * A detail page that could not be looked up because the database is down:
 * 503 with Retry-After, so search engines come back later instead of
 * dropping the page as gone (404).
 */
export function tryLaterResponse(locale: Locale): Response {
  const body =
    locale === 'es'
      ? 'Ahora mismo no podemos mostrar esta página. Vuelve a intentarlo en unos minutos.'
      : 'We cannot show this page right now. Please try again in a few minutes.';
  return new Response(body, {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '300', 'cache-control': 'no-store' },
  });
}
