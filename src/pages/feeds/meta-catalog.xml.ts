import type { APIRoute } from 'astro';
import { loadPublicCatalog } from '@/lib/catalog/loadProducts';
import { buildProductFeed } from '@/lib/catalog/productFeed';
import { loadProductTypes } from '@/lib/catalog/productTypes';
import { siteUrl } from '@/lib/server/env';
import type { Locale } from '@/i18n/routes';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const locale: Locale = url.searchParams.get('locale') === 'en' ? 'en' : 'es';
  const [{ products }, types] = await Promise.all([loadPublicCatalog(locale), loadProductTypes(locale)]);
  const xml = buildProductFeed({
    products,
    origin: siteUrl(),
    locale,
    types,
    channel: 'meta',
  });
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
