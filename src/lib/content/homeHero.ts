import { z } from 'zod';
import { t, type Locale } from '@/i18n';
import { localizedPath, workPath } from '@/i18n/routes';
import type { WorkEntry } from '@/lib/content/editorial';
import { hasSupabase } from '@/lib/server/env';

/**
 * The home page hero, edited in Admin › Portada (table site_home_hero).
 * Five designs share one content: texts in both languages, two buttons,
 * the plaque about the featured work, and images from Medios. Anything
 * left empty falls back to the featured work and to the built-in copy, so
 * the home page always has a complete hero.
 */

export const HERO_DESIGNS = ['collage', 'reveal', 'wall', 'sketchbook', 'salon'] as const;
export type HeroDesign = (typeof HERO_DESIGNS)[number];

/** Where the buttons can lead: sections of the site, in the visitor's language. */
export const HERO_LINKS = ['commissions', 'shop', 'work', 'gallery', 'about', 'contact'] as const;
export type HeroLink = (typeof HERO_LINKS)[number];

/** How many secondary images each design shows. */
export const HERO_EXTRAS: Record<HeroDesign, number> = {
  collage: 4,
  reveal: 0,
  wall: 0,
  sketchbook: 0,
  salon: 7,
};

const text = (max: number) => z.string().trim().max(max).default('');

const copySchema = z
  .object({
    eyebrow: text(80),
    titleTop: text(80),
    titleBottom: text(80),
    lead: text(400),
    primaryLabel: text(40),
    secondaryLabel: text(40),
    plaqueLabel: text(40),
    plaqueNote: text(60),
    photoCaption: text(60),
  })
  .strict();

const imageSchema = z
  .object({
    mediaId: z.uuid().nullable().default(null),
    src: z
      .string()
      .trim()
      .max(2000)
      // https, or a path on this site ("//host" would be another site).
      .refine((value) => value.startsWith('https://') || (value.startsWith('/') && !value.startsWith('//')), 'SRC'),
    altEs: text(300),
    altEn: text(300),
  })
  .strict();

export const heroContentSchema = z
  .object({
    design: z.enum(HERO_DESIGNS),
    copy: z.object({ es: copySchema, en: copySchema }).strict(),
    primaryLink: z.enum(HERO_LINKS),
    secondaryLink: z.enum(HERO_LINKS),
    /** Work shown on the plaque, and the source of any image left empty. */
    featuredWork: z.string().trim().max(120).nullable().default(null),
    images: z
      .object({
        main: imageSchema.nullable().default(null),
        photo: imageSchema.nullable().default(null),
        extras: z.array(imageSchema).max(7).default([]),
      })
      .strict(),
  })
  .strict();

export type HeroContent = z.infer<typeof heroContentSchema>;
export type HeroCopy = HeroContent['copy']['es'];
export type HeroImage = z.infer<typeof imageSchema>;

const DEFAULT_FEATURED = 'frankie';
const DEFAULT_EXTRAS = ['millie-cat', 'moquitos', 'tida', 'nara', 'sox-kira', 'chester', 'luna', 'max'];

/** The copy the site shipped with, split where the old headline broke. */
export function defaultCopy(locale: Locale): HeroCopy {
  const dict = t(locale);
  const es = locale === 'es';
  const match = dict.home.heroTitle.match(/^(.+?[.,])\s+(.+)$/);
  return {
    eyebrow: es ? 'Retratos de mascotas a grafito · Meili Stringfellow' : 'Pet portraits in graphite · Meili Stringfellow',
    titleTop: match ? match[1] : dict.home.heroTitle,
    titleBottom: match ? match[2] : '',
    lead: dict.home.heroLead,
    primaryLabel: dict.home.ctaCommission,
    secondaryLabel: dict.nav.shop,
    plaqueLabel: es ? 'En la pared' : 'On the wall',
    plaqueNote: es ? 'grafito sobre papel' : 'graphite on paper',
    // Empty: "la foto de <obra destacada>" (see resolveHero).
    photoCaption: '',
  };
}

export function defaultHeroContent(): HeroContent {
  return {
    design: 'collage',
    copy: { es: defaultCopy('es'), en: defaultCopy('en') },
    primaryLink: 'commissions',
    secondaryLink: 'shop',
    featuredWork: DEFAULT_FEATURED,
    images: { main: null, photo: null, extras: [] },
  };
}

/** Saved content, or the defaults when there is none (or it cannot be read). */
export async function loadHeroContent(): Promise<HeroContent> {
  if (!hasSupabase()) return defaultHeroContent();
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL as string,
      import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string,
    );
    const { data, error } = await client.from('site_home_hero').select('content').eq('id', 1).maybeSingle();
    if (error || !data) return defaultHeroContent();
    const parsed = heroContentSchema.safeParse(data.content);
    return parsed.success ? parsed.data : defaultHeroContent();
  } catch {
    return defaultHeroContent();
  }
}

// --- What a design draws -------------------------------------------------------

export type HeroPicture = {
  src: string;
  alt: string;
  /** Link to the work's page, when the picture is one of the works */
  href: string | null;
  /** Shared with the work page for the view transition */
  workId: string | null;
};

export type ResolvedHero = {
  design: HeroDesign;
  eyebrow: string;
  titleTop: string;
  titleBottom: string;
  lead: string;
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
  plaque: { label: string; note: string; title: string; href: string } | null;
  main: HeroPicture | null;
  photo: (HeroPicture & { caption: string }) | null;
  extras: HeroPicture[];
};

const srcOf = (work: WorkEntry, role: 'drawing' | 'reference_photo') =>
  work.data.assets.find((asset) => asset.role === role && asset.src)?.src ?? null;

/** Fill every empty field from the defaults, the featured work and the other works. */
export function resolveHero(
  content: HeroContent,
  works: WorkEntry[],
  locale: Locale,
  designOverride?: HeroDesign | null,
): ResolvedHero {
  const fallback = defaultCopy(locale);
  const saved = content.copy[locale];
  const copy = (key: keyof HeroCopy) => saved[key].trim() || fallback[key];
  const design = designOverride ?? content.design;

  const featured =
    works.find((w) => w.id === content.featuredWork && srcOf(w, 'drawing')) ??
    works.find((w) => w.id === DEFAULT_FEATURED && srcOf(w, 'drawing')) ??
    works.find((w) => srcOf(w, 'drawing')) ??
    null;
  const title = featured?.data.title[locale] ?? '';
  const href = (w: WorkEntry) => workPath(locale, w.data.pathSlugs[locale]);
  const alt = (image: HeroImage) => (locale === 'es' ? image.altEs : image.altEn).trim();
  const fromWork = (w: WorkEntry, role: 'drawing' | 'reference_photo'): HeroPicture | null => {
    const src = srcOf(w, role);
    return src ? { src, alt: w.data.title[locale], href: href(w), workId: w.data.id } : null;
  };
  const fromMedia = (image: HeroImage, fallbackAlt: string): HeroPicture => ({
    src: image.src,
    alt: alt(image) || fallbackAlt,
    href: null,
    workId: null,
  });

  const main = content.images.main
    ? fromMedia(content.images.main, title)
    : featured
      ? fromWork(featured, 'drawing')
      : null;

  const photoPicture = content.images.photo
    ? fromMedia(content.images.photo, locale === 'es' ? 'Fotografía original' : 'Original photograph')
    : featured
      ? fromWork(featured, 'reference_photo')
      : null;
  const photo = photoPicture
    ? {
        ...photoPicture,
        // The photo is the source, not a work page of its own.
        href: null,
        workId: null,
        alt: content.images.photo ? photoPicture.alt : `${locale === 'es' ? 'Fotografía original de' : 'Original photograph of'} ${title}`,
        caption:
          saved.photoCaption.trim() ||
          (title
            ? locale === 'es'
              ? `la foto de ${title}`
              : `${title}’s photo`
            : locale === 'es'
              ? 'la foto original'
              : 'the original photo'),
      }
    : null;

  // Chosen images first; any slot left over is filled with other works.
  const wanted = HERO_EXTRAS[design];
  const extras: HeroPicture[] = content.images.extras.slice(0, wanted).map((image) => fromMedia(image, ''));
  if (extras.length < wanted) {
    const used = new Set<string>([featured?.id ?? '']);
    const preferred = DEFAULT_EXTRAS.map((id) => works.find((w) => w.id === id)).filter(
      (w): w is WorkEntry => w !== undefined,
    );
    for (const w of [...preferred, ...works]) {
      if (extras.length >= wanted) break;
      if (used.has(w.id)) continue;
      used.add(w.id);
      const picture = fromWork(w, 'drawing');
      if (picture && picture.src !== main?.src) extras.push(picture);
    }
  }

  return {
    design,
    eyebrow: copy('eyebrow'),
    titleTop: copy('titleTop'),
    titleBottom: saved.titleTop.trim() ? saved.titleBottom.trim() : fallback.titleBottom,
    lead: copy('lead'),
    primary: { label: copy('primaryLabel'), href: localizedPath(locale, content.primaryLink) },
    secondary: { label: copy('secondaryLabel'), href: localizedPath(locale, content.secondaryLink) },
    plaque: featured
      ? { label: copy('plaqueLabel'), note: copy('plaqueNote'), title, href: href(featured) }
      : null,
    main,
    photo,
    extras,
  };
}

export function isHeroDesign(value: string | null | undefined): value is HeroDesign {
  return Boolean(value) && (HERO_DESIGNS as readonly string[]).includes(value as string);
}
