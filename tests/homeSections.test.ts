import { describe, expect, it } from 'vitest';
import type { WorkEntry } from '../src/lib/content/editorial';
import type { ProductPublic } from '../src/lib/domain/types';
import {
  defaultHomeSections,
  homeSectionsSchema,
  resolveHomeSections,
  type HomeSectionsContent,
} from '../src/lib/content/homeSections';

const work = (id: string, photo = true): WorkEntry => ({
  id,
  data: {
    id,
    pathSlugs: { es: id, en: id },
    title: { es: id.toUpperCase(), en: id.toUpperCase() },
    category: 'dog',
    assets: [
      { role: 'drawing', src: `/media/${id}-drawing.jpg` },
      ...(photo ? [{ role: 'reference_photo' as const, src: `/media/${id}-photo.jpg` }] : []),
    ],
    order: 0,
  },
});
const works = ['frankie', 'sox-kira', 'luna', 'max', 'nara', 'tida', 'milo', 'coco', 'kira', 'rex', 'lola'].map((id) =>
  work(id, id !== 'luna'),
);

const product = (id: string, category: ProductPublic['category']): ProductPublic => ({
  id,
  legacyId: null,
  sku: id,
  category,
  motif: 'Pug',
  status: 'published',
  priceCents: 999,
  currency: 'EUR',
  saleEnabled: false,
  inventoryMode: 'unverified',
  availability: 'unverified',
  slug: id,
  title: `Producto ${id}`,
  summary: '',
  description: '',
  coverImageUrl: null,
  imageUrls: [],
});
const products = [
  product('11111111-1111-4111-8111-111111111111', 'coasters'),
  product('22222222-2222-4222-8222-222222222222', 'mugs'),
  product('33333333-3333-4333-8333-333333333333', 'greeting-cards'),
  product('44444444-4444-4444-8444-444444444444', 'ornaments'),
];
const aboutImages = [
  { id: 'about-1', publicUrl: '/about/stall.jpg' },
  { id: 'about-2', publicUrl: '/about/2.jpg' },
  { id: 'about-3', publicUrl: '/about/desk.jpg' },
];
const sources = { works, products, aboutImages, featuredId: 'frankie' };
const image = (name: string) => ({
  mediaId: '6b160bed-9c8c-4442-bf96-fb6042c365b3',
  src: `https://example.supabase.co/storage/v1/object/public/portfolio-public/${name}`,
  altEs: `Foto ${name}`,
  altEn: `Photo ${name}`,
});
const edit = (patch: (c: HomeSectionsContent) => void) => {
  const content = defaultHomeSections();
  patch(content);
  return content;
};

describe('resolveHomeSections with nothing saved', () => {
  const home = resolveHomeSections(defaultHomeSections(), sources, 'es');

  it('shows every block as the site shipped', () => {
    expect(home.latest?.title).toBe('Últimos dibujos');
    expect(home.process?.title).toBe('De la fotografía al retrato');
    expect(home.shop?.title).toBe('Su arte, para tu casa');
    expect(home.artist?.eyebrow).toBe('La artista');
    expect(home.invite?.title).toBe('¿Dibujamos a tu compañero?');
  });

  it('compares Sox & Kira, and leaves it and the hero’s work out of the corridor', () => {
    expect(home.process?.photo.src).toBe('/media/sox-kira-photo.jpg');
    const ids = home.latest?.items.map((i) => i.workId) ?? [];
    expect(ids).not.toContain('frankie');
    expect(ids).not.toContain('sox-kira');
    expect(ids).toHaveLength(9);
  });

  it('features a mug, a card and a coaster, and Meili’s two photos', () => {
    expect(home.shop?.products.map((p) => p.category)).toEqual(['mugs', 'greeting-cards', 'coasters']);
    expect(home.artist?.portrait?.src).toBe('/about/stall.jpg');
    expect(home.artist?.desk?.src).toBe('/about/desk.jpg');
  });
});

describe('resolveHomeSections with edits', () => {
  it('uses the saved texts and falls back field by field and per language', () => {
    const home = resolveHomeSections(
      edit((c) => {
        c.latest.title = { es: 'Recién dibujados', en: '' };
        c.invite.ctaLabel = { es: 'Quiero su retrato', en: 'I want their portrait' };
      }),
      sources,
      'en',
    );
    expect(home.latest?.title).toBe('Latest drawings');
    expect(home.invite?.ctaLabel).toBe('I want their portrait');
  });

  it('shows the chosen works in their order, skipping ones without a drawing', () => {
    const home = resolveHomeSections(edit((c) => (c.latest.works = ['nara', 'gone', 'max'])), sources, 'es');
    expect(home.latest?.items.map((i) => i.workId)).toEqual(['nara', 'max']);
  });

  it('compares the chosen work, and photos from Medios override it', () => {
    const chosen = resolveHomeSections(edit((c) => (c.process.work = 'max')), sources, 'es');
    expect(chosen.process?.drawing.src).toBe('/media/max-drawing.jpg');
    const custom = resolveHomeSections(edit((c) => (c.process.photo = image('foto.jpg'))), sources, 'es');
    expect(custom.process?.photo).toEqual({ src: image('foto.jpg').src, alt: 'Foto foto.jpg' });
    expect(custom.process?.drawing.src).toBe('/media/sox-kira-drawing.jpg');
  });

  it('features the chosen products, ignoring ones no longer in the shop', () => {
    const home = resolveHomeSections(
      edit((c) => (c.shop.products = ['44444444-4444-4444-8444-444444444444', '99999999-9999-4999-8999-999999999999'])),
      sources,
      'es',
    );
    expect(home.shop?.products.map((p) => p.category)).toEqual(['ornaments']);
  });

  it('uses Meili’s photos from Medios', () => {
    const home = resolveHomeSections(edit((c) => (c.artist.portrait = image('meili.jpg'))), sources, 'es');
    expect(home.artist?.portrait?.src).toBe(image('meili.jpg').src);
    expect(home.artist?.desk?.src).toBe('/about/desk.jpg');
  });

  it('leaves hidden blocks out', () => {
    const home = resolveHomeSections(
      edit((c) => {
        c.shop.visible = false;
        c.invite.visible = false;
      }),
      sources,
      'es',
    );
    expect(home.shop).toBeNull();
    expect(home.invite).toBeNull();
    expect(home.artist).not.toBeNull();
  });
});

describe('homeSectionsSchema', () => {
  it('fills a partial save with the defaults', () => {
    const parsed = homeSectionsSchema.parse({ latest: { title: { es: 'Hola' } }, process: {}, shop: {}, artist: {}, invite: {} });
    expect(parsed.latest.title).toEqual({ es: 'Hola', en: '' });
    expect(parsed.process.showPrices).toBe(true);
  });

  it('rejects unknown fields, too many products and foreign image addresses', () => {
    const base = defaultHomeSections();
    expect(homeSectionsSchema.safeParse({ ...base, extra: {} }).success).toBe(false);
    expect(
      homeSectionsSchema.safeParse({ ...base, shop: { ...base.shop, products: products.map((p) => p.id) } }).success,
    ).toBe(false);
    expect(
      homeSectionsSchema.safeParse({ ...base, artist: { ...base.artist, desk: { ...image('x.jpg'), src: '//evil.example/x.jpg' } } })
        .success,
    ).toBe(false);
  });
});
