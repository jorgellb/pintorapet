import { describe, expect, it } from 'vitest';
import { buildShopSets, slugify, type ShopCollection } from '../src/lib/catalog/shopSets';
import type { ProductPublic } from '../src/lib/domain/types';

let n = 0;
const product = (
  category: ProductPublic['category'],
  motif: string,
  collectionId: string | null,
  cover = `/${motif}-${category}.jpg`,
): ProductPublic => ({
  id: `p${++n}`,
  legacyId: null,
  sku: `PD-${n}`,
  category,
  motif,
  status: 'published',
  priceCents: 499,
  currency: 'EUR',
  saleEnabled: false,
  inventoryMode: 'unverified',
  availability: 'unverified',
  slug: `p${n}`,
  title: `${category} ${motif}`,
  summary: '',
  description: '',
  coverImageUrl: cover,
  imageUrls: [cover],
  collectionId,
});

const collection = (id: string, code: string, name: string, sortOrder: number, portraitUrl: string | null = null): ShopCollection => ({
  id,
  code,
  name,
  description: '',
  portraitUrl,
  sortOrder,
});

describe('buildShopSets', () => {
  const pug = collection('c-pug', 'pug', 'Pug', 20);
  const frenchie = collection('c-fr', 'french-bulldog', 'Bulldog francés', 10, '/frenchie-portrait.jpg');

  it('follows the categories’ order and puts each product in its category', () => {
    const sets = buildShopSets(
      [product('mugs', 'Pug', 'c-pug'), product('mugs', 'French Bulldog', 'c-fr'), product('coasters', 'Pug', 'c-pug')],
      [pug, frenchie],
    );
    expect(sets.map((s) => s.id)).toEqual(['french-bulldog', 'pug']);
    expect(sets[1].items.map((p) => p.category)).toEqual(['coasters', 'mugs']);
    expect(sets[0].name).toBe('Bulldog francés');
  });

  it('orders products by type: card, coaster, mug, then any more', () => {
    const items = buildShopSets(
      [product('mugs', 'Pug', 'c-pug'), product('greeting-cards', 'Pug', 'c-pug'), product('coasters', 'Pug', 'c-pug'), product('mugs', 'Pug', 'c-pug')],
      [pug],
    )[0].items;
    expect(items.map((p) => p.category)).toEqual(['greeting-cards', 'coasters', 'mugs', 'mugs']);
  });

  it('uses the chosen portrait, else the coaster photo', () => {
    const sets = buildShopSets(
      [product('mugs', 'French Bulldog', 'c-fr'), product('coasters', 'Pug', 'c-pug', '/pug-coaster.jpg'), product('mugs', 'Pug', 'c-pug')],
      [pug, frenchie],
    );
    expect(sets.find((s) => s.id === 'french-bulldog')?.portrait).toBe('/frenchie-portrait.jpg');
    expect(sets.find((s) => s.id === 'pug')?.portrait).toBe('/pug-coaster.jpg');
  });

  it('keeps products without a category, grouped by motif after the categories', () => {
    const sets = buildShopSets([product('mugs', 'Golden Retriever', null), product('mugs', 'Pug', 'c-pug')], [pug]);
    expect(sets.map((s) => [s.id, s.name])).toEqual([
      ['pug', 'Pug'],
      ['golden-retriever', 'Golden Retriever'],
    ]);
  });

  it('leaves out hidden categories and empty ones', () => {
    // 'c-hidden' is not among the visible categories.
    const sets = buildShopSets([product('mugs', 'Pug', 'c-hidden')], [pug, frenchie]);
    expect(sets).toEqual([]);
  });
});

describe('slugify', () => {
  it('turns motifs into codes', () => {
    expect(slugify('Labrador Retriever Black')).toBe('labrador-retriever-black');
    expect(slugify('Bulldog Francés')).toBe('bulldog-frances');
  });
});
