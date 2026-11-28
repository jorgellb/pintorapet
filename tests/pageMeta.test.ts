import { describe, expect, it } from 'vitest';
import type { GalleryEntry, WorkEntry } from '../src/lib/content/editorial';
import {
  distinctNames,
  galleryMeta,
  productFallbackDescription,
  SECTION_META,
  workMeta,
} from '../src/lib/seo/pageMeta';

const work = (id: string, en: string, es: string, extra: Partial<WorkEntry['data']> = {}): WorkEntry => ({
  id,
  data: {
    id,
    pathSlugs: { en: id, es: id },
    title: { en, es },
    category: 'dog',
    assets: [],
    order: 0,
    ...extra,
  },
});

const piece = (id: string, en: string, group: GalleryEntry['data']['group'], extra: Partial<GalleryEntry['data']> = {}): GalleryEntry => ({
  id,
  data: { id, title: { en, es: en }, group, assets: [], order: 0, ...extra },
});

describe('distinctNames', () => {
  it('numbers names that repeat, in list order, and leaves the rest alone', () => {
    const items = ['Dog', 'Frankie', 'dog ', 'Dog'].map((name) => ({ name }));
    const names = distinctNames(items, (item) => item.name);
    expect(items.map((item) => names.get(item))).toEqual(['Dog (1)', 'Frankie', 'dog (2)', 'Dog (3)']);
  });
});

describe('workMeta', () => {
  const works = [work('dogs-a3-1', 'Dogs A3', 'Perros A3'), work('frankie', 'Frankie', 'Frankie'), work('dogs-a3-2', 'Dogs A3', 'Perros A3')];

  it('gives works that share a name different titles and descriptions', () => {
    const first = workMeta(works[0]!, works, 'es');
    const second = workMeta(works[2]!, works, 'es');
    expect(first.title).toBe('Perros A3 (1): retrato a lápiz · Pets Drawings');
    expect(second.title).toBe('Perros A3 (2): retrato a lápiz · Pets Drawings');
    expect(first.description).not.toBe(second.description);
  });

  it('describes a work with no text of its own', () => {
    expect(workMeta(works[1]!, works, 'en')).toEqual({
      title: 'Frankie: pencil portrait · Pets Drawings',
      description: 'Frankie: a pencil portrait drawn by hand in graphite by Meili Stringfellow, from the Pets Drawings portfolio.',
    });
  });

  it('prefers what Admin wrote: SEO fields, then the summary', () => {
    const own = work('chester', 'Chester', 'Chester', {
      summary: { en: 'Chester, a spaniel.', es: 'Chester, un spaniel.' },
      seo: { title: { en: 'Chester the spaniel | Pets Drawings' }, description: {} },
    });
    expect(workMeta(own, [own], 'en')).toEqual({ title: 'Chester the spaniel | Pets Drawings', description: 'Chester, a spaniel.' });
  });
});

describe('galleryMeta', () => {
  it('gives Mojácar a real description, not its name', () => {
    const mojacar = piece('mojacar', 'Mojácar', 'architecture');
    const meta = galleryMeta(mojacar, [mojacar], 'es');
    expect(meta.title).toBe('Mojácar: dibujo de arquitectura · Pets Drawings');
    expect(meta.description).toMatch(/^Un dibujo de Mojácar, el pueblo blanco/);
  });

  it('falls back to a sentence by group, and keeps a written summary', () => {
    const menus = [piece('menu-1', 'Menu', 'illustration'), piece('menu-2', 'Menu', 'illustration')];
    expect(galleryMeta(menus[1]!, menus, 'en')).toEqual({
      title: 'Menu (2): illustration · Pets Drawings',
      description: 'Menu (2): an illustration by Meili Stringfellow, from her extra gallery of portraits of people, places and illustrations.',
    });
    const written = piece('mojacar', 'Mojácar', 'architecture', { summary: { en: 'The old town.', es: 'El casco antiguo.' } });
    expect(galleryMeta(written, [written], 'en').description).toBe('The old town.');
  });
});

describe('section titles', () => {
  it('carry the search term and stay under 60 characters', () => {
    for (const page of Object.values(SECTION_META)) {
      for (const meta of Object.values(page)) {
        expect(meta.title.length).toBeLessThanOrEqual(60);
        expect(meta.title.endsWith(' · Pets Drawings')).toBe(true);
      }
    }
    expect(SECTION_META.home.es.title).not.toMatch(/^Inicio/);
    expect(SECTION_META.shop.es.description).toBeTruthy();
    expect(SECTION_META.work.en.description).toBeTruthy();
  });
});

describe('productFallbackDescription', () => {
  it('describes a product without a summary', () => {
    expect(productFallbackDescription('Taza Pug', 'es')).toBe(
      'Taza Pug, con un retrato a lápiz dibujado a mano por Meili Stringfellow. Envío desde España.',
    );
  });
});
