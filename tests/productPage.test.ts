import { describe, expect, it } from 'vitest';
import { sizedImage } from '../src/lib/catalog/imageSize';
import { productDetails } from '../src/lib/catalog/productDetails';
import { productJsonLd } from '../src/lib/catalog/productJsonLd';
import type { ProductPublic } from '../src/lib/domain/types';

const CLOUD = 'https://res.cloudinary.com/demo/image/upload/c_limit,w_2000/f_auto/q_auto/catalog-public/catalog/pug-mugs-1_jpg';

describe('sizedImage', () => {
  it('asks Cloudinary for a smaller copy', () => {
    expect(sizedImage(CLOUD, 480)).toBe(CLOUD.replace('c_limit,w_2000', 'c_limit,w_480'));
  });

  it('leaves other images alone', () => {
    expect(sizedImage('/images/pug.jpg', 480)).toBe('/images/pug.jpg');
    expect(sizedImage(null, 480)).toBeNull();
  });
});

describe('productDetails', () => {
  it('lists what is known of a mug, in both languages', () => {
    expect(productDetails('mugs', 'es')).toContainEqual({ label: 'Capacidad', value: '325 ml (11 oz)' });
    expect(productDetails('mugs', 'en')).toContainEqual({ label: 'Care', value: 'Dishwasher and microwave safe' });
  });

  it('says coasters come as a set of four', () => {
    expect(productDetails('coasters', 'es')[0]).toEqual({ label: 'Contenido', value: '4 posavasos con el mismo retrato' });
  });

  it('has nothing to say about an unknown type', () => {
    expect(productDetails('posters', 'es')).toEqual([]);
  });
});

const mug = {
  id: '11111111-1111-4111-8111-111111111111',
  sku: 'PD-2051',
  title: 'Taza Pug',
  summary: 'Taza de cerámica',
  description: 'Una taza.',
  priceCents: 999,
  saleEnabled: true,
  availability: 'available',
  coverImageUrl: CLOUD,
  imageUrls: [CLOUD],
} as unknown as ProductPublic;

describe('productJsonLd', () => {
  const ld = productJsonLd({
    product: mug,
    selected: mug,
    url: 'https://petsdrawings.com/es/tienda/taza-pug/',
    breadcrumbs: [
      { name: 'Tienda', url: 'https://petsdrawings.com/es/tienda/' },
      { name: 'Taza Pug', url: 'https://petsdrawings.com/es/tienda/taza-pug/' },
    ],
  });

  it('describes the product with its price and stock', () => {
    const product = ld[0] as Record<string, any>;
    expect(product['@type']).toBe('Product');
    expect(product.sku).toBe('PD-2051');
    expect(product.brand).toEqual({ '@type': 'Brand', name: 'Pets Drawings' });
    expect(product.offers).toMatchObject({ price: '9.99', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' });
  });

  it('says out of stock when it cannot be bought', () => {
    const sold = productJsonLd({ product: mug, selected: { ...mug, availability: 'sold_out' }, url: 'x', breadcrumbs: [] });
    expect((sold[0] as Record<string, any>).offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('adds the breadcrumbs', () => {
    const crumbs = ld[1] as Record<string, any>;
    expect(crumbs['@type']).toBe('BreadcrumbList');
    expect(crumbs.itemListElement[1]).toMatchObject({ position: 2, name: 'Taza Pug' });
  });
});
