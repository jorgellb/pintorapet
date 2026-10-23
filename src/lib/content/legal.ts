import type { Locale } from '@/i18n';

export type LegalPageKey =
  | 'privacy'
  | 'cookies'
  | 'terms'
  | 'shipping'
  | 'accountHelp';

type LegalDoc = {
  title: { en: string; es: string };
  updated: string;
  paragraphs: { en: string[]; es: string[] };
};

/**
 * Structural legal copy for the rebuild. Marked as pending owner review —
 * do not treat as final counsel-approved text before live sales.
 */
export const legalDocs: Record<LegalPageKey, LegalDoc> = {
  privacy: {
    title: { en: 'Privacy', es: 'Privacidad' },
    updated: '2026-10-22',
    paragraphs: {
      en: [
        'Pets Drawings (Meili Stringfellow) processes contact details, commission messages and shop order data only to respond to you, fulfil portraits or shop orders, and operate the website.',
        'Hosting and processing may involve Vercel (site), Supabase (database/auth/storage), Stripe (payments) and Resend (transactional email). Payment card data is handled by Stripe; we do not store full card numbers.',
        'You may request access, correction or deletion of personal data we hold by emailing info@petsdrawings.com. This page will be replaced with a fully reviewed policy before live sales.',
      ],
      es: [
        'Pets Drawings (Meili Stringfellow) trata datos de contacto, mensajes de encargo y pedidos de la tienda solo para responderte, realizar retratos o pedidos y operar el sitio.',
        'El alojamiento y el tratamiento pueden implicar Vercel (web), Supabase (base de datos/auth/almacenamiento), Stripe (pagos) y Resend (correo transaccional). Los datos de tarjeta los gestiona Stripe; no almacenamos el número completo.',
        'Puedes solicitar acceso, rectificación o eliminación de datos personales escribiendo a info@petsdrawings.com. Esta página se sustituirá por una política revisada antes de la venta real.',
      ],
    },
  },
  cookies: {
    title: { en: 'Cookies', es: 'Cookies' },
    updated: '2026-10-22',
    paragraphs: {
      en: [
        'We use essential cookies for language preference, cart identity and (when you sign in) admin session. These are required for the site to work.',
        'If you accept it, a first-party measurement records the page, the referring site, campaign parameters, country, language and device type. It does not store your IP address, name or a long-term identifier, and it is not shared with advertisers. You can refuse it in the notice; that choice is kept in this browser.',
        'You can clear cookies in your browser. Doing so may empty the cart or sign you out of the admin panel.',
      ],
      es: [
        'Usamos cookies esenciales para el idioma, la identidad del carrito y (si inicias sesión) la sesión de administración. Son necesarias para el funcionamiento del sitio.',
        'Si lo aceptas, una medición propia guarda la página, el sitio de procedencia, los parámetros de campaña, el país, el idioma y el tipo de dispositivo. No guarda tu IP, tu nombre ni un identificador permanente, y no se comparte con anunciantes. Puedes rechazarla en el aviso; esa elección se queda en este navegador.',
        'Puedes borrar las cookies en el navegador. Eso puede vaciar el carrito o cerrar la sesión de administración.',
      ],
    },
  },
  terms: {
    title: { en: 'Terms', es: 'Condiciones' },
    updated: '2026-10-22',
    paragraphs: {
      en: [
        'Shop products and commission portraits are offered by Meili Stringfellow trading as Pets Drawings. Prices are shown in euros.',
        'Commission quotes are estimates until confirmed in writing. Shop checkout totals are calculated on the server; client-displayed prices are informational until a quote is created.',
        'Artwork remains copyright of Meili Stringfellow. Personal-use prints from the shop do not transfer copyright. Final commercial terms will be published before live sales.',
      ],
      es: [
        'Los productos de la tienda y los encargos de retrato los ofrece Meili Stringfellow como Pets Drawings. Los precios se muestran en euros.',
        'Los presupuestos de encargo son estimaciones hasta confirmación por escrito. Los totales de compra los calcula el servidor; el precio en pantalla es informativo hasta crear una cotización.',
        'Las obras son © Meili Stringfellow. La compra de productos de la tienda no cede derechos de autor. Las condiciones comerciales definitivas se publicarán antes de la venta real.',
      ],
    },
  },
  shipping: {
    title: { en: 'Shipping & returns', es: 'Envíos y devoluciones' },
    updated: '2026-10-22',
    paragraphs: {
      en: [
        'Shipping zones, rates and fulfilment times are not yet finalised for this rebuild. Checkout remains disabled until shipping and inventory settings are confirmed.',
        'When sales are enabled, shipping costs will be shown before payment. Returns for shop goods will follow the published policy; commissioned originals are made to order and may have different rules.',
        'Contact info@petsdrawings.com for current shipping availability.',
      ],
      es: [
        'Las zonas de envío, tarifas y plazos aún no están cerrados en esta reconstrucción. El pago permanece desactivado hasta confirmar envíos e inventario.',
        'Cuando la venta esté activa, el coste de envío se mostrará antes del pago. Las devoluciones de productos de tienda seguirán la política publicada; los encargos son bajo pedido y pueden tener reglas distintas.',
        'Escribe a info@petsdrawings.com para la disponibilidad actual de envíos.',
      ],
    },
  },
  accountHelp: {
    title: { en: 'Guest checkout help', es: 'Ayuda de compra' },
    updated: '2026-10-22',
    paragraphs: {
      en: [
        'Shop purchases are guest checkout — there is no customer account migration from the previous WordPress shop.',
        'After payment you receive an order reference and an access token. Use Order status on this site to look up payment and fulfilment state. Keep the token private.',
        'Admin login is only for the artist’s private panel and is separate from guest shopping.',
      ],
      es: [
        'La compra es como invitado: no hay migración de cuentas de clientes desde la tienda WordPress anterior.',
        'Tras el pago recibes una referencia y un token de acceso. Usa Estado del pedido en este sitio para consultar pago y preparación. Mantén el token en privado.',
        'El acceso de administración es solo el panel privado de la artista y es independiente de la compra como invitado.',
      ],
    },
  },
};

export function getLegalDoc(pageKey: LegalPageKey, locale: Locale) {
  const doc = legalDocs[pageKey];
  return {
    title: doc.title[locale],
    updated: doc.updated,
    paragraphs: doc.paragraphs[locale],
  };
}
