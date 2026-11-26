import { describe, expect, it } from 'vitest';
import { productJsonLd } from '../src/lib/catalog/productJsonLd';
import { productReviewSummary, reviewExcerpt, type PublicReview } from '../src/lib/domain/reviews';
import type { ProductPublic } from '../src/lib/domain/types';

const mug = {
  id: '11111111-1111-4111-8111-111111111111',
  sku: 'PD-2051',
  title: 'Taza Pug',
  summary: 'Taza de cerámica',
  description: 'Una taza.',
  priceCents: 999,
  saleEnabled: true,
  availability: 'available',
  coverImageUrl: 'https://example.com/a.jpg',
  imageUrls: ['https://example.com/a.jpg'],
} as unknown as ProductPublic;

const review = (n: number, patch: Partial<PublicReview> = {}): PublicReview => ({
  id: `r${n}`,
  authorName: `Ana ${n}.`,
  city: 'Sevilla',
  petName: 'Lola',
  body: `Opinión ${n}`,
  locale: 'es',
  rating: 5,
  verified: true,
  photos: [],
  publishedAt: `2026-11-0${n}T10:00:00.000Z`,
  productId: mug.id,
  kind: 'product',
  ...patch,
});

const ld = (reviews?: Parameters<typeof productJsonLd>[0]['reviews']) =>
  productJsonLd({ product: mug, selected: mug, url: 'https://petsdrawings.com/es/tienda/taza-pug/', breadcrumbs: [], reviews })[0] as Record<string, any>;

describe('reviews in the product JSON-LD', () => {
  it('ignores unverified reviews and reviews without rating', () => {
    const summary = productReviewSummary([
      review(1, { rating: 4 }),
      review(2, { verified: false, rating: 1 }),
      review(3, { rating: null }),
      review(4, { rating: 5 }),
    ]);
    // the page lists all four; structured data only knows the verified, starred ones
    expect(summary.reviews).toHaveLength(4);
    expect(summary.jsonLd.items.map((r) => r.id)).toEqual(['r1', 'r4']);
    expect(summary.jsonLd).toMatchObject({ count: 2, average: 4.5 });

    const product = ld(summary.jsonLd);
    expect(product.aggregateRating).toEqual({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 2, bestRating: 5 });
    expect(product.review).toHaveLength(2);
    expect(product.review[0]).toEqual({
      '@type': 'Review',
      author: { '@type': 'Person', name: 'Ana 1.' },
      reviewRating: { '@type': 'Rating', ratingValue: 4, bestRating: 5 },
      reviewBody: 'Opinión 1',
      datePublished: '2026-11-01T10:00:00.000Z',
    });
  });

  it('aggregateRating 4.67 → 4.7', () => {
    const items = [review(1, { rating: 5 }), review(2, { rating: 5 }), review(3, { rating: 4 })];
    const product = ld({ items, average: 4.666666, count: 3 });
    expect(product.aggregateRating.ratingValue).toBe(4.7);
    expect(product.aggregateRating.reviewCount).toBe(3);
  });

  it('the count is the whole product, not the ten items shown', () => {
    const product = ld({ items: [review(1)], average: 4.8, count: 37 });
    expect(product.aggregateRating.reviewCount).toBe(37);
    expect(product.review).toHaveLength(1);
  });

  it('no reviews → no aggregateRating key', () => {
    for (const reviews of [undefined, { items: [], average: null, count: 0 }]) {
      const product = ld(reviews);
      expect('aggregateRating' in product).toBe(false);
      expect('review' in product).toBe(false);
    }
  });
});

describe('reviewExcerpt', () => {
  it('leaves a short review alone', () => {
    expect(reviewExcerpt('  Preciosa.  ')).toEqual({ text: 'Preciosa.', cut: false });
  });

  it('cuts a long one at a word, about 220 characters in', () => {
    const body = 'palabra '.repeat(60);
    const { text, cut } = reviewExcerpt(body);
    expect(cut).toBe(true);
    expect(text.endsWith('palabra…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(221);
    expect(text.length).toBeGreaterThan(190);
  });

  it('does not split an emoji and survives a single very long word', () => {
    expect(reviewExcerpt('🐶'.repeat(300)).text).toBe(`${'🐶'.repeat(220)}…`);
    expect(reviewExcerpt('x'.repeat(500)).text).toBe(`${'x'.repeat(220)}…`);
  });
});
