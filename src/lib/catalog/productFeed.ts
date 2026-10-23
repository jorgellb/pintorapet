import type { Locale } from '@/i18n/routes';
import { productPath } from '@/i18n/routes';
import type { ProductCategoryCode, ProductPublic } from '@/lib/domain/types';
import { variantTitle } from '@/lib/admin/slug';

export type FeedChannel = 'google' | 'meta';

const googleCategory: Record<ProductCategoryCode, string> = {
  'greeting-cards':
    'Arts & Entertainment > Party & Celebration > Gift Giving > Greeting Cards',
  coasters: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Coasters',
  mugs: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
};

const typeLabel: Record<ProductCategoryCode, Record<Locale, string>> = {
  'greeting-cards': { es: 'Tarjetas de felicitación', en: 'Greeting cards' },
  coasters: { es: 'Posavasos', en: 'Coasters' },
  mugs: { es: 'Tazas', en: 'Mugs' },
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function plain(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function absoluteUrl(origin: string, value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${origin}${value.startsWith('/') ? value : `/${value}`}`;
}

function price(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}

export type CatalogOffer = {
  id: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImages: string[];
  availability: 'in stock' | 'out of stock';
  price: string;
  priceValue: string;
  brand: 'Pets Drawings';
  condition: 'new';
  identifierExists: false;
  googleProductCategory: string;
  productType: string;
  /** Parent SKU shared by a product and its variations. */
  itemGroupId?: string;
};

/** Sellable rows become offers. Shared by the XML feeds and the Google/Meta push. */
export function catalogOffers(
  products: ProductPublic[],
  origin: string,
  locale: Locale,
): CatalogOffer[] {
  const base = origin.replace(/\/$/, '');
  const byId = new Map(products.map((p) => [p.id, p]));
  const parents = new Set(products.flatMap((p) => (p.parentId ? [p.parentId] : [])));
  return products.flatMap((product) => {
    const images = product.imageUrls.filter(Boolean);
    if (product.status !== 'published' || images.length === 0 || product.priceCents <= 0) return [];
    const onSale = product.saleEnabled && product.availability === 'available';
    const group = product.parentId ? byId.get(product.parentId) : parents.has(product.id) ? product : undefined;
    return [
      {
        ...(group ? { itemGroupId: group.sku || group.id } : {}),
        id: product.sku || product.id,
        title: plain(
          group === product && product.variantLabel
            ? variantTitle(product.title, product.variantLabel)
            : product.title,
        ),
        description: plain(product.description || product.summary || product.title),
        link: absoluteUrl(base, productPath(locale, product.slug)),
        imageLink: absoluteUrl(base, images[0]!),
        additionalImages: images.slice(1, 11).map((src) => absoluteUrl(base, src)),
        availability: onSale ? 'in stock' : 'out of stock',
        price: price(product.priceCents),
        priceValue: (product.priceCents / 100).toFixed(2),
        brand: 'Pets Drawings',
        condition: 'new',
        identifierExists: false,
        googleProductCategory: googleCategory[product.category],
        productType: `${typeLabel[product.category][locale]} > ${product.motif}`,
      },
    ];
  });
}

function itemXml(offer: CatalogOffer, channel: FeedChannel): string {
  const stock = channel === 'google' ? offer.availability.replaceAll(' ', '_') : offer.availability;
  const extra = offer.additionalImages.map(
    (src) => `      <g:additional_image_link>${escapeXml(src)}</g:additional_image_link>`,
  );
  return [
    '    <item>',
    `      <g:id>${escapeXml(offer.id)}</g:id>`,
    ...(offer.itemGroupId ? [`      <g:item_group_id>${escapeXml(offer.itemGroupId)}</g:item_group_id>`] : []),
    `      <g:title>${escapeXml(offer.title)}</g:title>`,
    `      <g:description>${escapeXml(offer.description)}</g:description>`,
    `      <g:link>${escapeXml(offer.link)}</g:link>`,
    `      <g:image_link>${escapeXml(offer.imageLink)}</g:image_link>`,
    ...extra,
    `      <g:availability>${stock}</g:availability>`,
    `      <g:price>${offer.price}</g:price>`,
    `      <g:brand>${offer.brand}</g:brand>`,
    `      <g:condition>${offer.condition}</g:condition>`,
    '      <g:identifier_exists>no</g:identifier_exists>',
    `      <g:google_product_category>${escapeXml(offer.googleProductCategory)}</g:google_product_category>`,
    `      <g:product_type>${escapeXml(offer.productType)}</g:product_type>`,
    '    </item>',
  ].join('\n');
}

/** RSS product feed. Google uses underscored availability; Meta uses “in stock”. */
export function buildProductFeed(input: {
  products: ProductPublic[];
  origin: string;
  locale: Locale;
  channel: FeedChannel;
}): string {
  const shop = absoluteUrl(input.origin, productPath(input.locale, ''));
  const title = input.channel === 'meta' ? 'Pets Drawings — Meta catalog' : 'Pets Drawings — Google Merchant';
  const items = catalogOffers(input.products, input.origin, input.locale).map((offer) =>
    itemXml(offer, input.channel),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '  <channel>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(shop)}</link>`,
    '    <description>Catálogo de Pets Drawings. Tarjetas, posavasos y tazas ilustrados.</description>',
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
