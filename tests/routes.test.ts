import { describe, expect, it } from 'vitest';
import { alternatePath } from '../src/i18n/routes';

describe('alternatePath', () => {
  it('maps the home page', () => {
    expect(alternatePath('/en/', 'es')).toBe('/es/');
    expect(alternatePath('/es/', 'en')).toBe('/en/');
  });

  it('translates localized section segments', () => {
    expect(alternatePath('/en/contact/', 'es')).toBe('/es/contacto/');
    expect(alternatePath('/es/encargos/', 'en')).toBe('/en/commissions/');
    expect(alternatePath('/en/about-me/', 'es')).toBe('/es/sobre-mi/');
    expect(alternatePath('/es/envios-devoluciones/', 'en')).toBe('/en/shipping-returns/');
  });

  it('prefers the longest matching route', () => {
    expect(alternatePath('/en/checkout/success/', 'es')).toBe('/es/compra/confirmacion/');
    expect(alternatePath('/es/compra/cancelada/', 'en')).toBe('/en/checkout/cancel/');
    expect(alternatePath('/en/checkout/', 'es')).toBe('/es/finalizar-compra/');
  });

  it('keeps the slug of detail pages', () => {
    expect(alternatePath('/en/work/chester/', 'es')).toBe('/es/obra/chester/');
    expect(alternatePath('/es/galeria/indian/', 'en')).toBe('/en/gallery/indian/');
  });

  it('works without a trailing slash', () => {
    expect(alternatePath('/en/contact', 'es')).toBe('/es/contacto/');
  });

  it('falls back to the target home for unknown paths', () => {
    expect(alternatePath('/en/does-not-exist/', 'es')).toBe('/es/');
    expect(alternatePath('/admin/', 'es')).toBe('/es/');
  });
});
