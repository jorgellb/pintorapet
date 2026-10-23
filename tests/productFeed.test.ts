import { describe, expect, it, vi } from 'vitest';
import { catalogOffers, buildProductFeed } from '@/lib/catalog/productFeed';
import { pushToGoogle, pushToMeta } from '@/lib/catalog/syncCatalog';
import type { ProductPublic } from '@/lib/domain/types';

const product: ProductPublic = {
  id: '1',
  legacyId: 1,
  sku: 'PD-1',
  category: 'mugs',
  motif: 'Springer & Spaniel',
  status: 'published',
  priceCents: 999,
  currency: 'EUR',
  saleEnabled: false,
  inventoryMode: 'unverified',
  availability: 'unverified',
  slug: 'taza-springer',
  title: 'Taza <Springer>',
  summary: 'Una taza.',
  description: '',
  coverImageUrl: '/media/catalog/mug.jpg',
  imageUrls: ['/media/catalog/mug.jpg', 'https://cdn.example/extra.jpg'],
};

describe('product feeds', () => {
  it('escapes text and uses Google availability', () => {
    const xml = buildProductFeed({
      products: [product],
      origin: 'https://petsdrawings.com',
      locale: 'es',
      channel: 'google',
    });
    expect(xml).toContain('<g:title>Taza &lt;Springer&gt;</g:title>');
    expect(xml).toContain('<g:id>PD-1</g:id>');
    expect(xml).toContain('<g:price>9.99 EUR</g:price>');
    expect(xml).toContain('<g:availability>out_of_stock</g:availability>');
    expect(xml).toContain('https://petsdrawings.com/es/tienda/taza-springer/');
    expect(xml).toContain('https://petsdrawings.com/media/catalog/mug.jpg');
    expect(xml).toContain('<g:additional_image_link>https://cdn.example/extra.jpg</g:additional_image_link>');
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
    expect(xml).toContain('Springer &amp; Spaniel');
  });

  it('marks a sellable product in stock with Meta wording', () => {
    const xml = buildProductFeed({
      products: [{ ...product, saleEnabled: true, availability: 'available' }],
      origin: 'https://petsdrawings.com',
      locale: 'en',
      channel: 'meta',
    });
    expect(xml).toContain('<g:availability>in stock</g:availability>');
    expect(xml).toContain('https://petsdrawings.com/en/shop/taza-springer/');
  });

  it('does not call Google or Meta when credentials are missing', async () => {
    const fetchImpl = vi.fn();
    const offers = catalogOffers([product], 'https://petsdrawings.com', 'es');
    const google = await pushToGoogle(offers, null, fetchImpl);
    const meta = await pushToMeta(offers, null, fetchImpl);
    expect(google.configured).toBe(false);
    expect(meta.configured).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips products without an image', () => {
    const xml = buildProductFeed({
      products: [{ ...product, imageUrls: [], coverImageUrl: null }],
      origin: 'https://petsdrawings.com',
      locale: 'es',
      channel: 'google',
    });
    expect(xml).not.toContain('<item>');
  });
});
