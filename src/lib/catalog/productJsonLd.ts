import type { ProductPublic } from '@/lib/domain/types';

/**
 * schema.org data for a product page (Google's rich results: price, stock,
 * breadcrumbs). Same brand and stock rule as the shopping feeds (productFeed.ts).
 */
export function productJsonLd(input: {
  product: ProductPublic;
  /** The option on show (a keyring's shape…): its price and stock. */
  selected: ProductPublic;
  url: string;
  breadcrumbs: Array<{ name: string; url: string }>;
}): object[] {
  const { product, selected, url, breadcrumbs } = input;
  const onSale = selected.saleEnabled && selected.availability === 'available';
  const images = (product.imageUrls.length ? product.imageUrls : [product.coverImageUrl]).filter(Boolean);
  const out: object[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title,
      description: product.summary || product.description,
      sku: selected.sku,
      image: images,
      brand: { '@type': 'Brand', name: 'Pets Drawings' },
      offers: {
        '@type': 'Offer',
        url,
        price: (selected.priceCents / 100).toFixed(2),
        priceCurrency: 'EUR',
        availability: onSale ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
      },
    },
  ];
  if (breadcrumbs.length) {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs.map((crumb, i) => ({ '@type': 'ListItem', position: i + 1, name: crumb.name, item: crumb.url })),
    });
  }
  return out;
}

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export const jsonLdText = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
