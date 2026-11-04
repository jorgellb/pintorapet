import { describe, expect, it } from 'vitest';
import type { GalleryEntry, WorkEntry } from '../src/lib/content/editorial';
import type { ProductPublic } from '../src/lib/domain/types';
import { buildSitemapEntries, renderRobots, renderSitemap, SITEMAP_PAGES } from '../src/lib/seo/sitemap';

const work: WorkEntry = {
  id: 'frankie',
  data: {
    id: 'frankie',
    pathSlugs: { es: 'frankie-es', en: 'frankie-en' },
    title: { es: 'Frankie & co', en: 'Frankie & co' },
    category: 'dog',
    assets: [{ role: 'reference_photo', src: '/media/photo.jpg' }, { role: 'drawing', src: '/media/frankie.jpg' }],
    order: 0,
  },
};
const gallery: GalleryEntry = {
  id: 'nana',
  data: { id: 'nana', title: { es: 'Nana', en: 'Nana' }, group: 'people', assets: [{ role: 'drawing', src: 'https://cdn.example/nana.jpg' }], order: 0 },
};
const product = (id: string, slug: string, parentId: string | null = null): ProductPublic => ({
  id,
  legacyId: null,
  sku: id,
  category: 'mugs',
  motif: 'Pug',
  status: 'published',
  priceCents: 999,
  currency: 'EUR',
  saleEnabled: false,
  inventoryMode: 'unverified',
  availability: 'unverified',
  slug,
  title: `Taza ${slug}`,
  summary: '',
  description: '',
  coverImageUrl: 'https://cdn.example/mug.jpg',
  imageUrls: ['https://cdn.example/mug.jpg', 'https://cdn.example/mug-2.jpg'],
  parentId,
});

const entries = buildSitemapEntries({
  works: [work],
  gallery: [gallery],
  productsEs: [product('p1', 'taza-pug'), product('p2', 'taza-pug-a5', 'p1'), product('p3', 'solo-es')],
  productsEn: [product('p1', 'pug-mug'), product('p2', 'pug-mug-a5', 'p1')],
});

describe('buildSitemapEntries', () => {
  it('pairs each page with its other-language address', () => {
    expect(entries).toContainEqual(expect.objectContaining({ es: '/es/sobre-mi/', en: '/en/about-me/' }));
    expect(entries).toContainEqual(expect.objectContaining({ es: '/es/obra/frankie-es/', en: '/en/work/frankie-en/' }));
    expect(entries).toContainEqual(expect.objectContaining({ es: '/es/galeria/nana/', en: '/en/gallery/nana/' }));
    expect(entries).toContainEqual(expect.objectContaining({ es: '/es/tienda/taza-pug/', en: '/en/shop/pug-mug/' }));
  });

  it('lists products once: no variations, nothing without its English page', () => {
    const shop = entries.filter((e) => e.es.startsWith('/es/tienda/') && e.es !== '/es/tienda/');
    expect(shop.map((e) => e.es)).toEqual(['/es/tienda/taza-pug/']);
  });

  it('keeps carts, checkout and accounts out', () => {
    const all = entries.flatMap((e) => [e.es, e.en]).join(' ');
    for (const path of ['/carrito/', '/cart/', '/cuenta/', '/account/', '/finalizar-compra/', '/checkout/']) {
      expect(all).not.toContain(path);
    }
    expect(entries).toHaveLength(SITEMAP_PAGES.length + 3);
  });

  it('carries the drawing, not the reference photo', () => {
    expect(entries.find((e) => e.es === '/es/obra/frankie-es/')?.images).toEqual([{ loc: '/media/frankie.jpg', title: 'Frankie & co' }]);
  });
});

describe('renderSitemap', () => {
  const xml = renderSitemap(entries, 'https://petsdrawings.com');

  it('writes absolute, escaped addresses with hreflang and images', () => {
    expect(xml).toContain('<loc>https://petsdrawings.com/es/obra/frankie-es/</loc>');
    expect(xml).toContain('hreflang="x-default" href="https://petsdrawings.com/en/work/frankie-en/"');
    expect(xml).toContain('<image:loc>https://petsdrawings.com/media/frankie.jpg</image:loc>');
    expect(xml).toContain('<image:title>Frankie &amp; co</image:title>');
    expect(xml.match(/<url>/g)).toHaveLength(entries.length * 2);
  });
});

describe('renderRobots', () => {
  it('lets crawlers in, keeps them out of private pages and points at the sitemap', () => {
    const robots = renderRobots('https://petsdrawings.com');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /admin/');
    expect(robots).toContain('Disallow: /es/cuenta/');
    expect(robots).toContain('Sitemap: https://petsdrawings.com/sitemap.xml');
  });
});
