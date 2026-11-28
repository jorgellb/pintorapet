import type { Locale } from '@/i18n/routes';
import type { GalleryEntry, WorkEntry } from '@/lib/content/editorial';

/**
 * Titles and meta descriptions for search results and link previews. A page's
 * own text (Admin, content files) wins; these fill what it leaves empty.
 * Titles stay under about 60 characters, where results cut them.
 */

const BRAND = 'Pets Drawings';
const withBrand = (text: string) => `${text} · ${BRAND}`;

type Meta = { title: string; description?: string };

/** Section pages whose plain names ("Inicio", "Tienda"…) say nothing to a search. */
export const SECTION_META: Record<'home' | 'work' | 'gallery' | 'shop' | 'commissions' | 'about', Record<Locale, Meta>> = {
  home: {
    en: { title: withBrand('Pencil pet portraits from your photos') },
    es: { title: withBrand('Retratos de mascotas a lápiz por encargo') },
  },
  work: {
    en: {
      title: withBrand('Pencil pet portraits: the portfolio'),
      description:
        'Pencil portraits of dogs, cats, horses and people, drawn by hand in graphite by Meili Stringfellow from photographs.',
    },
    es: {
      title: withBrand('Obra: retratos de mascotas a lápiz'),
      description:
        'Retratos a lápiz de perros, gatos, caballos y personas, dibujados a mano en grafito por Meili Stringfellow a partir de fotografías.',
    },
  },
  gallery: {
    en: { title: withBrand('Portraits of people and other drawings') },
    es: { title: withBrand('Retratos de personas y otros dibujos') },
  },
  shop: {
    en: {
      title: withBrand('Pet portrait cards, mugs and gifts'),
      description:
        'Greeting cards, coasters, mugs and more, printed with Meili Stringfellow’s pencil pet portraits and shipped from Spain.',
    },
    es: {
      title: withBrand('Tazas y tarjetas con retratos de mascotas'),
      description:
        'Tarjetas, posavasos, tazas y más, con los retratos a lápiz de mascotas de Meili Stringfellow y envío desde España.',
    },
  },
  commissions: {
    en: { title: withBrand('Commission a pencil portrait of your pet') },
    es: { title: withBrand('Encarga un retrato a lápiz de tu mascota') },
  },
  about: {
    en: { title: withBrand('Meili Stringfellow, pencil portrait artist') },
    es: { title: withBrand('Meili Stringfellow, retratista a lápiz') },
  },
};

/**
 * Names that tell pieces apart: two works both called "Dog" become "Dog (1)"
 * and "Dog (2)", in the list's order, so their pages do not share a title.
 */
export function distinctNames<T>(items: readonly T[], name: (item: T) => string): Map<T, string> {
  const key = (item: T) => name(item).trim().toLocaleLowerCase();
  const total = new Map<string, number>();
  for (const item of items) total.set(key(item), (total.get(key(item)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<T, string>();
  for (const item of items) {
    const k = key(item);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    out.set(item, total.get(k)! > 1 ? `${name(item).trim()} (${n})` : name(item).trim());
  }
  return out;
}

const text = (value: string | undefined | null) => value?.trim() || undefined;

/** An artwork page: "Frankie: pencil portrait · Pets Drawings". */
export function workMeta(entry: WorkEntry, works: readonly WorkEntry[], locale: Locale): Meta {
  const es = locale === 'es';
  const name = distinctNames(works, (w) => w.data.title[locale]).get(entry) ?? entry.data.title[locale];
  const portrait = entry.data.category !== 'other';
  const kind = es ? (portrait ? 'retrato a lápiz' : 'dibujo a lápiz') : portrait ? 'pencil portrait' : 'pencil drawing';
  const fallback = es
    ? `${name}: ${kind} dibujado a mano en grafito por Meili Stringfellow, del portfolio de Pets Drawings.`
    : `${name}: a ${kind} drawn by hand in graphite by Meili Stringfellow, from the Pets Drawings portfolio.`;
  return {
    title: text(entry.data.seo?.title[locale]) ?? withBrand(`${name}: ${kind}`),
    description: text(entry.data.seo?.description[locale]) ?? text(entry.data.summary?.[locale]) ?? fallback,
  };
}

const GALLERY_KIND: Record<GalleryEntry['data']['group'], Record<Locale, { noun: string; phrase: string }>> = {
  people: {
    en: { noun: 'portrait drawing', phrase: 'a portrait drawn by Meili Stringfellow' },
    es: { noun: 'retrato dibujado', phrase: 'un retrato dibujado por Meili Stringfellow' },
  },
  architecture: {
    en: { noun: 'architecture drawing', phrase: 'an architecture drawing by Meili Stringfellow' },
    es: { noun: 'dibujo de arquitectura', phrase: 'un dibujo de arquitectura de Meili Stringfellow' },
  },
  illustration: {
    en: { noun: 'illustration', phrase: 'an illustration by Meili Stringfellow' },
    es: { noun: 'ilustración', phrase: 'una ilustración de Meili Stringfellow' },
  },
  other: {
    en: { noun: 'drawing', phrase: 'a drawing by Meili Stringfellow' },
    es: { noun: 'dibujo', phrase: 'un dibujo de Meili Stringfellow' },
  },
};

/** Words for gallery pieces whose Admin entry has no summary yet; a summary written there replaces them. */
const GALLERY_SUMMARIES: Record<string, Record<Locale, string>> = {
  mojacar: {
    en: 'A drawing of Mojácar, the white hilltop village on the coast of Almería, by Meili Stringfellow: one of the architecture pieces in her extra gallery.',
    es: 'Un dibujo de Mojácar, el pueblo blanco en lo alto de la costa de Almería, por Meili Stringfellow: una de las obras de arquitectura de su galería extra.',
  },
};

/** A piece of the extra gallery: "Mojácar: architecture drawing · Pets Drawings". */
export function galleryMeta(entry: GalleryEntry, items: readonly GalleryEntry[], locale: Locale): Meta {
  const es = locale === 'es';
  const name = distinctNames(items, (g) => g.data.title[locale]).get(entry) ?? entry.data.title[locale];
  const kind = GALLERY_KIND[entry.data.group]?.[locale] ?? GALLERY_KIND.other[locale];
  const fallback = es
    ? `${name}: ${kind.phrase}, de su galería extra de retratos de personas, lugares e ilustraciones.`
    : `${name}: ${kind.phrase}, from her extra gallery of portraits of people, places and illustrations.`;
  return {
    title: withBrand(`${name}: ${kind.noun}`),
    description: text(entry.data.summary?.[locale]) ?? GALLERY_SUMMARIES[entry.data.id]?.[locale] ?? fallback,
  };
}

/** A product with no description of its own in Admin. */
export function productFallbackDescription(title: string, locale: Locale): string {
  return locale === 'es'
    ? `${title}, con un retrato a lápiz dibujado a mano por Meili Stringfellow. Envío desde España.`
    : `${title}, printed with a pencil portrait drawn by hand by Meili Stringfellow. Shipped from Spain.`;
}
