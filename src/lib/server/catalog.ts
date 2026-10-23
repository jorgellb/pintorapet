/** Re-export catalogue helpers used by views. */
export {
  loadPublicCatalog as loadPublicProducts,
  loadManifestProductBySlug,
  loadManifestProducts,
  type CatalogSource,
} from '@/lib/catalog/loadProducts';

import {
  loadManifestProductBySlug,
  loadPublicCatalog,
  type CatalogSource,
} from '@/lib/catalog/loadProducts';
import type { Locale } from '@/i18n';
import type { ProductPublic } from '@/lib/domain/types';

export async function loadPublicProductBySlug(
  locale: Locale,
  slug: string,
): Promise<{ product: ProductPublic | null; source: CatalogSource }> {
  const { source } = await loadPublicCatalog(locale);
  const product = await loadManifestProductBySlug(locale, slug);
  return { product, source };
}
