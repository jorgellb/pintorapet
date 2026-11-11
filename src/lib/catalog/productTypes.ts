import type { Locale } from '@/i18n/routes';
import { hasSupabase } from '@/lib/server/env';

/**
 * Product types (cards, coasters, mugs…), edited in Admin › Tienda › Tipos de
 * producto (table categories). Their order is the order of the shop's filters
 * and of the pieces in each portrait's row.
 */

export const TYPE_ICONS = ['card', 'coaster', 'mug', 'ornament', 'keyring', 'print', 'bag', 'tag'] as const;
export type TypeIcon = (typeof TYPE_ICONS)[number];

/** One type, in one language. */
export type ProductType = {
  code: string;
  /** On the shop's filters: "Tazas". */
  plural: string;
  /** On the price tag and in a portrait's row: "Taza". */
  singular: string;
  /** Mid-sentence: "en tarjeta, taza y bola de Navidad". */
  phrase: string;
  icon: TypeIcon;
  googleCategory: string;
};

/** A row of catalog_categories_v. */
export type ProductTypeRow = {
  code: string;
  name_es: string;
  name_en: string;
  singular_es: string;
  singular_en: string;
  phrase_es: string;
  phrase_en: string;
  icon: string;
  google_category: string;
  sort_order: number;
};

/** The singular with a lowercase first letter, unless a phrase was written for it. */
export const phraseOf = (singular: string, phrase: string) =>
  phrase.trim() || singular.charAt(0).toLowerCase() + singular.slice(1);

const isIcon = (value: string): value is TypeIcon => (TYPE_ICONS as readonly string[]).includes(value);

export const fromRow = (row: ProductTypeRow, locale: Locale): ProductType => {
  const singular = locale === 'es' ? row.singular_es : row.singular_en;
  return {
    code: row.code,
    plural: locale === 'es' ? row.name_es : row.name_en,
    singular,
    phrase: phraseOf(singular, locale === 'es' ? row.phrase_es : row.phrase_en),
    icon: isIcon(row.icon) ? row.icon : 'tag',
    googleCategory: row.google_category,
  };
};

/** The types as the shop had them before they were editable: used when the database cannot be read. */
export const DEFAULT_TYPES: ProductTypeRow[] = [
  {
    code: 'greeting-cards',
    name_es: 'Tarjetas',
    name_en: 'Cards',
    singular_es: 'Tarjeta',
    singular_en: 'Card',
    phrase_es: '',
    phrase_en: '',
    icon: 'card',
    google_category: 'Arts & Entertainment > Party & Celebration > Gift Giving > Greeting Cards',
    sort_order: 10,
  },
  {
    code: 'coasters',
    name_es: 'Posavasos',
    name_en: 'Coasters',
    singular_es: 'Posavasos',
    singular_en: 'Coaster',
    phrase_es: '',
    phrase_en: '',
    icon: 'coaster',
    google_category: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Coasters',
    sort_order: 20,
  },
  {
    code: 'mugs',
    name_es: 'Tazas',
    name_en: 'Mugs',
    singular_es: 'Taza',
    singular_en: 'Mug',
    phrase_es: '',
    phrase_en: '',
    icon: 'mug',
    google_category: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
    sort_order: 30,
  },
  {
    code: 'ornaments',
    name_es: 'Bolas de Navidad',
    name_en: 'Christmas ornaments',
    singular_es: 'Bola de Navidad',
    singular_en: 'Christmas ornament',
    phrase_es: '',
    phrase_en: 'Christmas ornament',
    icon: 'ornament',
    google_category: 'Home & Garden > Decor > Seasonal & Holiday Decorations > Holiday Ornaments',
    sort_order: 40,
  },
  {
    code: 'keyrings',
    name_es: 'Llaveros',
    name_en: 'Keyrings',
    singular_es: 'Llavero',
    singular_en: 'Keyring',
    phrase_es: '',
    phrase_en: '',
    icon: 'keyring',
    google_category: 'Apparel & Accessories > Handbag & Wallet Accessories > Keychains',
    sort_order: 50,
  },
];

/** The visible types, in their order. The built-in ones when the database cannot be read. */
export async function loadProductTypes(locale: Locale): Promise<ProductType[]> {
  const fallback = DEFAULT_TYPES.map((row) => fromRow(row, locale));
  if (!hasSupabase()) return fallback;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL as string,
      import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string,
    );
    const { data, error } = await client.from('catalog_categories_v').select('*').order('sort_order');
    if (error || !data) return fallback;
    return (data as ProductTypeRow[]).map((row) => fromRow(row, locale));
  } catch {
    return fallback;
  }
}
