import type { Locale } from '@/i18n';

/** Meili's WhatsApp (also on the contact page and in the footer, +34 636 386 531). */
export const WHATSAPP_URL = 'https://wa.me/34636386531';

/** A chat with Meili, with the first message already written when there is one. */
export function whatsappLink(text?: string): string {
  return text ? `${WHATSAPP_URL}?text=${encodeURIComponent(text)}` : WHATSAPP_URL;
}

/** The first message from a product page: which piece, and its link, so Meili sees it at once. */
export function productQuestion(product: { title: string; sku: string; url: string }, locale: Locale): string {
  return locale === 'es'
    ? `Hola, Meili. Tengo una pregunta sobre «${product.title}» (${product.sku}): ${product.url}`
    : `Hello Meili, I have a question about “${product.title}” (${product.sku}): ${product.url}`;
}
