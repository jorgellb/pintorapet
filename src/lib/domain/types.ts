export type ProductCategoryCode = 'greeting-cards' | 'coasters' | 'mugs';

export type ProductStatus = 'draft' | 'published' | 'archived';

export type InventoryMode = 'tracked' | 'made_to_order' | 'unverified';

export type AvailabilityPublic =
  | 'available'
  | 'sold_out'
  | 'unverified'
  | 'unavailable';

export interface ProductPublic {
  id: string;
  legacyId: number | null;
  sku: string;
  category: ProductCategoryCode;
  motif: string;
  status: ProductStatus;
  priceCents: number;
  currency: 'EUR';
  saleEnabled: boolean;
  inventoryMode: InventoryMode;
  availability: AvailabilityPublic;
  slug: string;
  title: string;
  summary: string;
  description: string;
  coverImageUrl: string | null;
  imageUrls: string[];
  /** Set on variations; points at the product shown in the shop. */
  parentId?: string | null;
  variantLabel?: string;
  variantOrder?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}
