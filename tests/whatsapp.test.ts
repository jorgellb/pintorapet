import { describe, expect, it } from 'vitest';
import { WHATSAPP_URL, productQuestion, whatsappLink } from '../src/lib/domain/whatsapp';

describe('whatsappLink', () => {
  it('opens a chat with Meili', () => {
    expect(WHATSAPP_URL).toBe('https://wa.me/34636386531');
    expect(whatsappLink()).toBe(WHATSAPP_URL);
  });

  it('writes the first message, encoded', () => {
    expect(whatsappLink('Hola, ¿qué tal?')).toBe('https://wa.me/34636386531?text=Hola%2C%20%C2%BFqu%C3%A9%20tal%3F');
  });
});

describe('productQuestion', () => {
  it('names the piece and links to it, in the visitor’s language', () => {
    const product = { title: 'Taza Pug', sku: 'PD-2051', url: 'https://petsdrawings.com/es/tienda/taza-pug/' };
    expect(productQuestion(product, 'es')).toBe(
      'Hola, Meili. Tengo una pregunta sobre «Taza Pug» (PD-2051): https://petsdrawings.com/es/tienda/taza-pug/',
    );
    expect(productQuestion({ ...product, title: 'Pug Mug' }, 'en')).toBe(
      'Hello Meili, I have a question about “Pug Mug” (PD-2051): https://petsdrawings.com/es/tienda/taza-pug/',
    );
  });
});
