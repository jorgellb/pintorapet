import { localizedPath, productPath, workPath, type RouteKey } from '@/i18n/routes';
import type { GalleryEntry, WorkEntry } from '@/lib/content/editorial';
import type { ProductPublic } from '@/lib/domain/types';

/**
 * sitemap.xml: every public page in both languages, each pointing at its
 * other-language version (hreflang), with the drawings and product photos
 * (Google's image extension). Carts, checkout, accounts and the admin stay out.
 */

export type SitemapImage = { loc: string; title: string };
export type SitemapEntry = { es: string; en: string; images: SitemapImage[] };

/** Section pages search engines should find. */
export const SITEMAP_PAGES: RouteKey[] = [
  'home',
  'about',
  'work',
  'gallery',
  'commissions',
  'shop',
  'contact',
  'shipping',
  'accountHelp',
  'privacy',
  'cookies',
  'terms',
];

/** Paths no crawler should spend time on (see robots.txt). */
export const PRIVATE_PATHS = [
  '/admin/',
  '/api/',
  '/es/carrito/',
  '/en/cart/',
  '/es/finalizar-compra/',
  '/en/checkout/',
  '/es/compra/',
  '/es/estado-pedido/',
  '/en/order-status/',
  '/es/cuenta/',
  '/en/account/',
];

type Sources = {
  works: WorkEntry[];
  gallery: GalleryEntry[];
  /** The shop in Spanish and in English: the same products, each with its own address. */
  productsEs: ProductPublic[];
  productsEn: ProductPublic[];
};

const drawingOf = (assets: Array<{ role: string; src?: string }>) =>
  assets.find((a) => a.role === 'drawing' && a.src)?.src ?? assets.find((a) => a.src)?.src ?? null;

export function buildSitemapEntries({ works, gallery, productsEs, productsEn }: Sources): SitemapEntry[] {
  const pages = SITEMAP_PAGES.map((key) => ({
    es: localizedPath('es', key),
    en: localizedPath('en', key),
    images: [],
  }));

  const workPages = works.map((w) => {
    const src = drawingOf(w.data.assets);
    return {
      es: workPath('es', w.data.pathSlugs.es),
      en: workPath('en', w.data.pathSlugs.en),
      images: src ? [{ loc: src, title: w.data.title.es }] : [],
    };
  });

  const galleryPages = gallery.map((g) => {
    const src = drawingOf(g.data.assets);
    return {
      es: localizedPath('es', 'gallery', g.data.id),
      en: localizedPath('en', 'gallery', g.data.id),
      images: src ? [{ loc: src, title: g.data.title.es }] : [],
    };
  });

  // Variations share their product's page; only products shown in the shop.
  const english = new Map(productsEn.map((p) => [p.id, p]));
  const productPages = productsEs
    .filter((p) => !p.parentId && english.has(p.id))
    .map((p) => ({
      es: productPath('es', p.slug),
      en: productPath('en', english.get(p.id)!.slug),
      images: p.imageUrls.slice(0, 3).map((loc) => ({ loc, title: p.title })),
    }));

  return [...pages, ...workPages, ...galleryPages, ...productPages];
}

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function renderSitemap(entries: SitemapEntry[], origin: string): string {
  const abs = (path: string) => escapeXml(new URL(path, origin).href);
  const urls = entries.flatMap((entry) => {
    const alternates = [
      `    <xhtml:link rel="alternate" hreflang="es" href="${abs(entry.es)}"/>`,
      `    <xhtml:link rel="alternate" hreflang="en" href="${abs(entry.en)}"/>`,
      // The site's root sends visitors to the English pages.
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(entry.en)}"/>`,
    ].join('\n');
    const images = entry.images
      .map(
        (image) =>
          `    <image:image>\n      <image:loc>${abs(image.loc)}</image:loc>\n      <image:title>${escapeXml(image.title)}</image:title>\n    </image:image>`,
      )
      .join('\n');
    return [entry.es, entry.en].map(
      (path) => `  <url>\n    <loc>${abs(path)}</loc>\n${alternates}${images ? `\n${images}` : ''}\n  </url>`,
    );
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function renderRobots(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`),
    // Previews of the home page designs (?portada=…) are not pages of their own.
    'Disallow: /*?portada=',
    '',
    `Sitemap: ${new URL('/sitemap.xml', origin).href}`,
    '',
  ].join('\n');
}
