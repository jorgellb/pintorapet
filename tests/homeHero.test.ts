import { describe, expect, it } from 'vitest';
import type { WorkEntry } from '../src/lib/content/editorial';
import {
  HERO_EXTRAS,
  defaultHeroContent,
  heroContentSchema,
  isHeroDesign,
  resolveHero,
  type HeroContent,
} from '../src/lib/content/homeHero';

const work = (id: string, title: string, photo = true): WorkEntry => ({
  id,
  data: {
    id,
    pathSlugs: { es: id, en: id },
    title: { es: title, en: title },
    category: 'dog',
    assets: [
      { role: 'drawing', src: `/media/${id}-drawing.jpg` },
      ...(photo ? [{ role: 'reference_photo' as const, src: `/media/${id}-photo.jpg` }] : []),
    ],
    order: 0,
  },
});

const works = [
  work('frankie', 'Frankie'),
  work('millie-cat', 'Millie'),
  work('moquitos', 'Moquitos'),
  work('tida', 'Tida', false),
  work('nara', 'Nara'),
  work('sox-kira', 'Sox y Kira'),
  work('chester', 'Chester'),
  work('luna', 'Luna'),
  work('max', 'Max'),
  work('otro', 'Otro'),
];

const media = (name: string) => ({
  mediaId: '6b160bed-9c8c-4442-bf96-fb6042c365b3',
  src: `https://example.supabase.co/storage/v1/object/public/portfolio-public/${name}`,
  altEs: `Dibujo ${name}`,
  altEn: `Drawing ${name}`,
});

describe('resolveHero with nothing saved', () => {
  it('is the home page the site shipped with', () => {
    const hero = resolveHero(defaultHeroContent(), works, 'es');
    expect(hero.design).toBe('collage');
    expect([hero.titleTop, hero.titleBottom]).toEqual(['Su mirada,', 'para siempre.']);
    expect(hero.primary).toEqual({ label: 'Encargar un retrato', href: '/es/encargos/' });
    expect(hero.secondary.href).toBe('/es/tienda/');
    expect(hero.main?.src).toBe('/media/frankie-drawing.jpg');
    expect(hero.photo?.caption).toBe('la foto de Frankie');
    expect(hero.extras.map((e) => e.workId)).toEqual(['millie-cat', 'moquitos', 'tida', 'nara']);
    expect(hero.plaque).toMatchObject({ title: 'Frankie', href: '/es/obra/frankie/' });
  });

  it('speaks English on the English home', () => {
    const hero = resolveHero(defaultHeroContent(), works, 'en');
    expect(hero.titleTop).toBe('Their character.');
    expect(hero.photo?.caption).toBe('Frankie’s photo');
    expect(hero.primary.href).toBe('/en/commissions/');
  });
});

describe('resolveHero with edits', () => {
  const edited = (patch: Partial<HeroContent>): HeroContent => ({ ...defaultHeroContent(), ...patch });

  it('uses the saved texts and falls back field by field', () => {
    const content = edited({});
    content.copy.es = { ...content.copy.es, titleTop: 'Retratos con alma', titleBottom: '', lead: '' };
    const hero = resolveHero(content, works, 'es');
    expect(hero.titleTop).toBe('Retratos con alma');
    // A one-line title stays one line.
    expect(hero.titleBottom).toBe('');
    expect(hero.lead).toContain('Retratos a lápiz');
  });

  it('prefers the images chosen in Medios', () => {
    const hero = resolveHero(
      edited({ images: { main: media('luna.jpg'), photo: media('luna-foto.jpg'), extras: [media('a.jpg')] } }),
      works,
      'es',
    );
    expect(hero.main).toMatchObject({ src: media('luna.jpg').src, alt: 'Dibujo luna.jpg', href: null });
    expect(hero.photo?.alt).toBe('Dibujo luna-foto.jpg');
    // One chosen, three filled in from the works.
    expect(hero.extras).toHaveLength(HERO_EXTRAS.collage);
    expect(hero.extras[0].src).toBe(media('a.jpg').src);
  });

  it('follows the featured work and the chosen links', () => {
    const hero = resolveHero(edited({ featuredWork: 'luna', primaryLink: 'contact', secondaryLink: 'gallery' }), works, 'en');
    expect(hero.main?.src).toBe('/media/luna-drawing.jpg');
    expect(hero.plaque?.title).toBe('Luna');
    expect([hero.primary.href, hero.secondary.href]).toEqual(['/en/contact/', '/en/gallery/']);
    expect(hero.extras.some((e) => e.workId === 'luna')).toBe(false);
  });

  it('gives each design the number of pictures it hangs', () => {
    expect(resolveHero(defaultHeroContent(), works, 'es', 'salon').extras).toHaveLength(7);
    expect(resolveHero(defaultHeroContent(), works, 'es', 'wall').extras).toHaveLength(0);
  });

  it('copes with a featured work that has no photo', () => {
    const hero = resolveHero(edited({ featuredWork: 'tida' }), works, 'es', 'reveal');
    expect(hero.photo).toBeNull();
    expect(hero.main?.src).toBe('/media/tida-drawing.jpg');
  });
});

describe('heroContentSchema', () => {
  it('accepts the defaults and fills missing fields', () => {
    expect(heroContentSchema.parse(defaultHeroContent()).design).toBe('collage');
  });

  it('rejects unknown designs, links and fields', () => {
    const base = defaultHeroContent();
    expect(heroContentSchema.safeParse({ ...base, design: 'neon' }).success).toBe(false);
    expect(heroContentSchema.safeParse({ ...base, primaryLink: 'https://evil.example' }).success).toBe(false);
    expect(heroContentSchema.safeParse({ ...base, extra: true }).success).toBe(false);
  });

  it('only takes images from this site or over https', () => {
    const base = defaultHeroContent();
    const withMain = (src: string) => ({ ...base, images: { ...base.images, main: { ...media('x.jpg'), src } } });
    expect(heroContentSchema.safeParse(withMain('javascript:alert(1)')).success).toBe(false);
    expect(heroContentSchema.safeParse(withMain('http://insecure.example/x.jpg')).success).toBe(false);
    expect(heroContentSchema.safeParse(withMain('//evil.example/x.jpg')).success).toBe(false);
    expect(heroContentSchema.safeParse(withMain('/media/portfolio/x.jpg')).success).toBe(true);
  });

  it('caps the pictures around at seven', () => {
    const base = defaultHeroContent();
    const extras = Array.from({ length: 8 }, (_, i) => media(`${i}.jpg`));
    expect(heroContentSchema.safeParse({ ...base, images: { ...base.images, extras } }).success).toBe(false);
  });
});

describe('isHeroDesign', () => {
  it('only knows the five designs', () => {
    expect(isHeroDesign('wall')).toBe(true);
    expect(isHeroDesign('WALL')).toBe(false);
    expect(isHeroDesign(null)).toBe(false);
  });
});
