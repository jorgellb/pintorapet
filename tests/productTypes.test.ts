import { describe, expect, it } from 'vitest';
import { DEFAULT_TYPES, fromRow, phraseOf } from '../src/lib/catalog/productTypes';

describe('phraseOf', () => {
  it('uses the singular with a lowercase first letter when no phrase is set', () => {
    expect(phraseOf('Bola de Navidad', '')).toBe('bola de Navidad');
    expect(phraseOf('Taza', '  ')).toBe('taza');
  });

  it('keeps the phrase written for it', () => {
    expect(phraseOf('Christmas ornament', 'Christmas ornament')).toBe('Christmas ornament');
  });
});

describe('fromRow', () => {
  const row = {
    code: 'ornaments',
    name_es: 'Bolas de Navidad',
    name_en: 'Christmas ornaments',
    singular_es: 'Bola de Navidad',
    singular_en: 'Christmas ornament',
    phrase_es: '',
    phrase_en: 'Christmas ornament',
    icon: 'ornament',
    google_category: 'Home & Garden > Decor',
    sort_order: 40,
  };

  it('reads a type in each language', () => {
    expect(fromRow(row, 'es')).toEqual({
      code: 'ornaments',
      plural: 'Bolas de Navidad',
      singular: 'Bola de Navidad',
      phrase: 'bola de Navidad',
      icon: 'ornament',
      googleCategory: 'Home & Garden > Decor',
    });
    expect(fromRow(row, 'en').phrase).toBe('Christmas ornament');
  });

  it('draws a plain tag for an icon it does not know', () => {
    expect(fromRow({ ...row, icon: 'rocket' }, 'es').icon).toBe('tag');
  });
});

describe('DEFAULT_TYPES', () => {
  it('is what the shop showed before types were editable, in that order', () => {
    expect(DEFAULT_TYPES.map((t) => t.code)).toEqual(['greeting-cards', 'coasters', 'mugs', 'ornaments', 'keyrings']);
    expect(fromRow(DEFAULT_TYPES[0], 'es').plural).toBe('Tarjetas');
  });
});
