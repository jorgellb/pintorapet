import { z } from 'zod';
import { t, type Locale } from '@/i18n';
import { localizedPath, workPath } from '@/i18n/routes';
import type { WorkEntry } from '@/lib/content/editorial';
import { imageSchema, type HeroImage } from '@/lib/content/homeHero';
import type { ProductPublic } from '@/lib/domain/types';
import { hasSupabase } from '@/lib/server/env';

/**
 * The blocks of the home page below the hero, edited in Admin › Portada ›
 * Bloques (table site_home_sections): their texts in both languages, their
 * pictures, and whether each one shows. Anything left empty keeps what the
 * home page showed before, so with nothing saved it is unchanged.
 */

const text = (max: number) => z.string().trim().max(max).default('');
const localized = (max: number) =>
  z.object({ es: text(max), en: text(max) }).strict().default({ es: '', en: '' });

export const homeSectionsSchema = z
  .object({
    latest: z
      .object({
        visible: z.boolean().default(true),
        title: localized(80),
        lead: localized(300),
        linkLabel: localized(60),
        /** Works shown, in order; empty: the latest ones. */
        works: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
      })
      .strict(),
    process: z
      .object({
        visible: z.boolean().default(true),
        title: localized(80),
        text: localized(600),
        ctaLabel: localized(40),
        showPrices: z.boolean().default(true),
        /** Work whose photo and drawing are compared. */
        work: z.string().trim().max(120).nullable().default(null),
        photo: imageSchema.nullable().default(null),
        drawing: imageSchema.nullable().default(null),
      })
      .strict(),
    shop: z
      .object({
        visible: z.boolean().default(true),
        title: localized(80),
        lead: localized(300),
        linkLabel: localized(60),
        /** Products shown, in order; empty: a mug, a card and a coaster. */
        products: z.array(z.uuid()).max(3).default([]),
      })
      .strict(),
    artist: z
      .object({
        visible: z.boolean().default(true),
        eyebrow: localized(40),
        text: localized(600),
        linkLabel: localized(40),
        caption: localized(60),
        portrait: imageSchema.nullable().default(null),
        desk: imageSchema.nullable().default(null),
      })
      .strict(),
    invite: z
      .object({
        visible: z.boolean().default(true),
        title: localized(80),
        label: localized(60),
        placeholder: localized(40),
        ctaLabel: localized(40),
      })
      .strict(),
  })
  .strict();

export type HomeSectionsContent = z.infer<typeof homeSectionsSchema>;
type Localized = { es: string; en: string };

/** The copy the home page shipped with. */
export function defaultSectionCopy(locale: Locale) {
  const dict = t(locale);
  const es = locale === 'es';
  return {
    latest: {
      title: dict.home.latest,
      lead: es
        ? 'Cada retrato empieza con una fotografía y termina, semanas después, en papel.'
        : 'Every portrait begins with a photograph and ends, weeks later, on paper.',
      linkLabel: es ? 'Ver toda la obra' : 'See all the work',
    },
    process: {
      title: dict.home.fromPhoto,
      text: es
        ? 'Envías tus fotografías favoritas. Meili estudia la luz, el pelaje y, sobre todo, la mirada, y lo dibuja a mano, trazo a trazo, en grafito.'
        : 'You send your favourite photographs. Meili studies the light, the coat and above all the gaze, then draws it by hand, stroke by stroke, in graphite.',
      ctaLabel: dict.home.ctaCommission,
    },
    shop: {
      title: es ? 'Su arte, para tu casa' : 'Her art, for your home',
      lead: dict.shop.lead,
      linkLabel: es ? 'Ver la tienda' : 'Visit the shop',
    },
    artist: {
      eyebrow: es ? 'La artista' : 'The artist',
      text: es
        ? 'Desde su estudio en España, Meili dibuja retratos de mascotas a partir de fotografías, y también personas e ilustraciones para negocios y publicaciones.'
        : 'From her studio in Spain, Meili draws pet portraits from photographs, as well as people and illustrations for businesses and publications.',
      linkLabel: es ? 'Conoce a Meili' : 'Meet Meili',
      caption: es ? 'Meili, en el mercado' : 'Meili, at the market',
    },
    invite: {
      title: es ? '¿Dibujamos a tu compañero?' : 'Shall we draw your companion?',
      label: es ? '¿Cómo se llama?' : 'What is their name?',
      placeholder: es ? 'Escribe su nombre' : 'Type their name',
      ctaLabel: dict.home.ctaCommission,
    },
  };
}

export function defaultHomeSections(): HomeSectionsContent {
  return homeSectionsSchema.parse({ latest: {}, process: {}, shop: {}, artist: {}, invite: {} });
}

/** Saved blocks, or the defaults when there are none (or they cannot be read). */
export async function loadHomeSections(): Promise<HomeSectionsContent> {
  if (!hasSupabase()) return defaultHomeSections();
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL as string,
      import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string,
    );
    const { data, error } = await client.from('site_home_sections').select('content').eq('id', 1).maybeSingle();
    if (error || !data) return defaultHomeSections();
    const parsed = homeSectionsSchema.safeParse(data.content);
    return parsed.success ? parsed.data : defaultHomeSections();
  } catch {
    return defaultHomeSections();
  }
}

// --- What the home page draws ----------------------------------------------------

export type Picture = { src: string; alt: string };

export type ResolvedSections = {
  latest: null | {
    title: string;
    lead: string;
    linkLabel: string;
    items: Array<{ src: string; title: string; href: string; workId: string }>;
  };
  process: null | {
    title: string;
    text: string;
    ctaLabel: string;
    showPrices: boolean;
    photo: Picture;
    drawing: Picture;
  };
  shop: null | { title: string; lead: string; linkLabel: string; products: ProductPublic[] };
  artist: null | {
    eyebrow: string;
    text: string;
    linkLabel: string;
    caption: string;
    portrait: Picture | null;
    desk: Picture | null;
  };
  invite: null | { title: string; label: string; placeholder: string; ctaLabel: string };
};

type Sources = {
  works: WorkEntry[];
  products: ProductPublic[];
  /** Photos of Meili from the site's extras (about-1: at her stall, about-3: at her desk). */
  aboutImages: Array<{ id: string; publicUrl?: string | null }>;
  /** The hero's featured work, so the blocks do not show it again. */
  featuredId: string | null;
};

const srcOf = (w: WorkEntry, role: 'drawing' | 'reference_photo') =>
  w.data.assets.find((a) => a.role === role && a.src)?.src ?? null;

export function resolveHomeSections(content: HomeSectionsContent, sources: Sources, locale: Locale): ResolvedSections {
  const fallback = defaultSectionCopy(locale);
  const pick = (value: Localized, backup: string) => value[locale].trim() || backup;
  const alt = (image: HeroImage, backup: string) => (locale === 'es' ? image.altEs : image.altEn).trim() || backup;
  const { works, products, aboutImages, featuredId } = sources;
  const es = locale === 'es';

  // From photograph to portrait: the chosen work, Sox & Kira, or the first work with both.
  const hasBoth = (w: WorkEntry) => Boolean(srcOf(w, 'drawing') && srcOf(w, 'reference_photo'));
  const p = content.process;
  const pair =
    works.find((w) => w.id === p.work && hasBoth(w)) ??
    works.find((w) => w.id === 'sox-kira' && hasBoth(w)) ??
    works.find((w) => w.id !== featuredId && hasBoth(w)) ??
    null;
  const pairName = pair?.data.title[locale] ?? '';
  const dict = t(locale);
  const photoSrc = p.photo?.src ?? (pair ? srcOf(pair, 'reference_photo') : null);
  const drawingSrc = p.drawing?.src ?? (pair ? srcOf(pair, 'drawing') : null);
  const process =
    p.visible && photoSrc && drawingSrc
      ? {
          title: pick(p.title, fallback.process.title),
          text: pick(p.text, fallback.process.text),
          ctaLabel: pick(p.ctaLabel, fallback.process.ctaLabel),
          showPrices: p.showPrices,
          photo: { src: photoSrc, alt: p.photo ? alt(p.photo, dict.art.photo) : `${pairName}: ${dict.art.photo}` },
          drawing: { src: drawingSrc, alt: p.drawing ? alt(p.drawing, dict.art.drawing) : `${pairName}: ${dict.art.drawing}` },
        }
      : null;

  // Latest drawings: the chosen works, else the latest ones not already above.
  const withDrawing = (w: WorkEntry | undefined): w is WorkEntry => Boolean(w && srcOf(w, 'drawing'));
  const chosen = content.latest.works.map((id) => works.find((w) => w.id === id)).filter(withDrawing);
  const latestWorks = (
    chosen.length > 0
      ? chosen
      : works.filter((w) => w.id !== featuredId && w.id !== pair?.id && srcOf(w, 'drawing')).slice(0, 9)
  ).map((w) => ({
    src: srcOf(w, 'drawing')!,
    title: w.data.title[locale],
    href: workPath(locale, w.data.pathSlugs[locale]),
    workId: w.data.id,
  }));
  const latest =
    content.latest.visible && latestWorks.length > 0
      ? {
          title: pick(content.latest.title, fallback.latest.title),
          lead: pick(content.latest.lead, fallback.latest.lead),
          linkLabel: pick(content.latest.linkLabel, fallback.latest.linkLabel),
          items: latestWorks,
        }
      : null;

  // Shop: the chosen products still on sale in the shop, else a mug, a card and a coaster.
  const chosenProducts = content.shop.products
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is ProductPublic => product !== undefined);
  const shopProducts =
    chosenProducts.length > 0
      ? chosenProducts
      : (['mugs', 'greeting-cards', 'coasters'] as const)
          .map((kind) => products.find((product) => product.category === kind))
          .filter((product): product is ProductPublic => product !== undefined);
  const shop =
    content.shop.visible && shopProducts.length > 0
      ? {
          title: pick(content.shop.title, fallback.shop.title),
          lead: pick(content.shop.lead, fallback.shop.lead),
          linkLabel: pick(content.shop.linkLabel, fallback.shop.linkLabel),
          products: shopProducts,
        }
      : null;

  // The artist: chosen photos, else the ones the site shipped with.
  const extra = (id: string, index: number) =>
    aboutImages.find((image) => image.id === id)?.publicUrl ?? aboutImages[index]?.publicUrl ?? null;
  const a = content.artist;
  const portraitSrc = a.portrait?.src ?? extra('about-1', 0);
  const deskSrc = a.desk?.src ?? extra('about-3', 2);
  const artist = a.visible
    ? {
        eyebrow: pick(a.eyebrow, fallback.artist.eyebrow),
        text: pick(a.text, fallback.artist.text),
        linkLabel: pick(a.linkLabel, fallback.artist.linkLabel),
        caption: pick(a.caption, fallback.artist.caption),
        portrait: portraitSrc
          ? {
              src: portraitSrc,
              alt: a.portrait ? alt(a.portrait, 'Meili') : es ? 'Meili en su puesto de un mercado' : 'Meili at her market stall',
            }
          : null,
        desk: deskSrc
          ? {
              src: deskSrc,
              alt: a.desk ? alt(a.desk, 'Meili') : es ? 'Meili en su mesa de dibujo' : 'Meili at her drawing desk',
            }
          : null,
      }
    : null;

  const i = content.invite;
  const invite = i.visible
    ? {
        title: pick(i.title, fallback.invite.title),
        label: pick(i.label, fallback.invite.label),
        placeholder: pick(i.placeholder, fallback.invite.placeholder),
        ctaLabel: pick(i.ctaLabel, fallback.invite.ctaLabel),
      }
    : null;

  return { latest, process, shop, artist, invite };
}

/** Where the blocks' links lead (fixed: the work, the commissions page, the shop, about). */
export const sectionLinks = (locale: Locale) => ({
  work: localizedPath(locale, 'work'),
  commissions: localizedPath(locale, 'commissions'),
  shop: localizedPath(locale, 'shop'),
  about: localizedPath(locale, 'about'),
  contact: localizedPath(locale, 'contact'),
});
