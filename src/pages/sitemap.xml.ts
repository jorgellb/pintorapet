import type { APIRoute } from 'astro';
import { loadGallery, loadWorks } from '@/lib/content/editorial';
import { loadPublicCatalog, topLevelProducts } from '@/lib/catalog/loadProducts';
import { buildSitemapEntries, renderSitemap } from '@/lib/seo/sitemap';

export const prerender = false;

/** Every public page in both languages, with their drawings and product photos. */
export const GET: APIRoute = async ({ site }) => {
  const [works, gallery, es, en] = await Promise.all([
    loadWorks(),
    loadGallery(),
    loadPublicCatalog('es'),
    loadPublicCatalog('en'),
  ]);
  const xml = renderSitemap(
    buildSitemapEntries({
      works,
      gallery,
      productsEs: topLevelProducts(es.products),
      productsEn: topLevelProducts(en.products),
    }),
    String(site ?? 'https://petsdrawings.com'),
  );
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // New works and products show up within the hour.
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
