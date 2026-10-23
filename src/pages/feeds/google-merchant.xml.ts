import type { APIRoute } from 'astro';
import { loadPublicCatalog } from '@/lib/catalog/loadProducts';
import { buildProductFeed } from '@/lib/catalog/productFeed';
import { siteUrl } from '@/lib/server/env';
import type { Locale } from '@/i18n/routes';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const locale: Locale = url.searchParams.get('locale') === 'en' ? 'en' : 'es';
  const { products } = await loadPublicCatalog(locale);
  const xml = buildProductFeed({
    products,
    origin: siteUrl(),
    locale,
    channel: 'google',
  });
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
