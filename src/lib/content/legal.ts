import type { Locale } from '@/i18n';
import { localizedPath, type RouteKey } from '@/i18n/routes';
import type { SellerIdentity } from '@/lib/server/sellerIdentity';

export type LegalPageKey = 'privacy' | 'cookies' | 'terms' | 'shipping' | 'accountHelp';

/**
 * Blocks that are not plain text: the seller's identity (read from the shop
 * settings at request time), the model withdrawal form (which carries that
 * identity) and the control to change the analytics choice.
 */
type Special = 'identity' | 'withdrawalForm' | 'analyticsChoice';

/**
 * As written below: a string is a paragraph, an array of strings a list,
 * `{ h }` a subheading. Inside text, `[label](href)` is a link and `code`
 * is a name (a cookie, a storage key).
 */
type Block = string | string[] | { h: string } | { special: Special };
type Section = { heading: string; id?: string; blocks: Block[] };
type Content = { title: string; description: string; intro: string[]; sections: Section[] };
type LegalDoc = { updated: string; es: Content; en: Content };

export type InlinePart = { text: string; href?: string; code?: boolean };
export type RenderedBlock =
  | { type: 'p'; parts: InlinePart[] }
  | { type: 'list'; items: InlinePart[][] }
  | { type: 'h3'; text: string }
  | { type: Special };
export type RenderedSection = { id: string; heading: string; blocks: RenderedBlock[] };

const UPDATED = '2026-11-28';
const MAIL = '[info@petsdrawings.com](mailto:info@petsdrawings.com)';
const AEPD = '[www.aepd.es](https://www.aepd.es)';
const page = (locale: Locale, key: RouteKey, hash = '') => `${localizedPath(locale, key)}${hash}`;

/**
 * The returns policy, word for word on the terms and on the shipping page.
 * Product structured data states the same facts: 14 days from delivery,
 * return by post at the customer's cost, refund with standard outbound
 * shipping by the same method within 14 days, defects at the shop's cost,
 * no withdrawal for commissions and personalised products (art. 103 c).
 */
export const returnsPolicy: Record<Locale, string[]> = {
  es: [
    'Productos de la tienda que no están personalizados: tienes 14 días naturales desde la entrega para desistir de la compra, sin dar explicaciones.',
    'La devolución se hace por correo postal o mensajería, y el coste directo de devolver el producto corre de tu cuenta.',
    'Te devolvemos lo que pagaste, incluido el envío estándar de ida, por el mismo medio de pago y en un máximo de 14 días desde que nos comunicas que desistes. Podemos esperar a recibir el producto, o a que nos envíes el justificante de que lo has devuelto, antes de hacer el reembolso.',
    'Si un producto llega defectuoso o dañado, la devolución la pagamos nosotros.',
    'Los retratos por encargo y los productos personalizados según tus indicaciones no tienen derecho de desistimiento (art. 103 c del texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios, TRLGDCU), salvo que tengan un defecto.',
  ],
  en: [
    'Shop products that are not personalised: you have 14 calendar days from delivery to withdraw from the purchase, without giving a reason.',
    'You return the product by post or courier, and you pay the direct cost of returning it.',
    'We refund what you paid, including the standard outbound shipping, through the same payment method and within 14 days of being told you are withdrawing. We may wait until the product is back with us, or until you send proof that you have returned it, before refunding.',
    'If a product arrives defective or damaged, we pay for the return.',
    'Custom portraits (commissions) and products personalised to your specification have no right of withdrawal (art. 103 c of the Spanish Consumer Protection Act, TRLGDCU), except for defects.',
  ],
};

/** Annex B of the TRLGDCU (Annex I B of Directive 2011/83/EU). */
export const withdrawalForm: Record<
  Locale,
  { title: string; note: string; to: string; lines: string[]; footnote: string; before: string }
> = {
  es: {
    before: 'Copia el texto en un email o en papel y complétalo. Añade la referencia del pedido si la tienes.',
    title: 'Modelo de formulario de desistimiento',
    note: '(Solo debe cumplimentar y enviar el presente formulario si desea desistir del contrato.)',
    to: 'A la atención de:',
    lines: [
      'Por la presente le comunico/comunicamos (*) que desisto de mi/desistimos de nuestro (*) contrato de venta del siguiente bien/prestación del siguiente servicio (*):',
      'Pedido el/recibido el (*):',
      'Nombre del consumidor y usuario o de los consumidores y usuarios:',
      'Domicilio del consumidor y usuario o de los consumidores y usuarios:',
      'Firma del consumidor y usuario o de los consumidores y usuarios (solo si el presente formulario se presenta en papel):',
      'Fecha:',
    ],
    footnote: '(*) Táchese lo que no proceda.',
  },
  en: {
    before: 'Copy the text into an email or onto paper and fill it in. Add the order reference if you have it.',
    title: 'Model withdrawal form',
    note: '(Complete and return this form only if you wish to withdraw from the contract.)',
    to: 'To:',
    lines: [
      'I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract of sale of the following goods (*)/for the provision of the following service (*):',
      'Ordered on (*)/received on (*):',
      'Name of consumer(s):',
      'Address of consumer(s):',
      'Signature of consumer(s) (only if this form is notified on paper):',
      'Date:',
    ],
    footnote: '(*) Delete as appropriate.',
  },
};

/** The control on the cookies page that reopens the analytics notice. */
export const analyticsChoiceCopy: Record<
  Locale,
  { yes: string; no: string; none: string; button: string }
> = {
  es: {
    yes: 'Ahora mismo, en este navegador, la medición de visitas está aceptada.',
    no: 'Ahora mismo, en este navegador, la medición de visitas está rechazada.',
    none: 'En este navegador aún no has elegido si aceptas la medición de visitas.',
    button: 'Cambiar mi elección',
  },
  en: {
    yes: 'Right now, in this browser, visit measurement is accepted.',
    no: 'Right now, in this browser, visit measurement is declined.',
    none: 'You have not yet chosen in this browser whether to accept visit measurement.',
    button: 'Change my choice',
  },
};

export const legalDocs: Record<LegalPageKey, LegalDoc> = {
  privacy: {
    updated: UPDATED,
    es: {
      title: 'Política de privacidad',
      description:
        'Quién trata tus datos en Pets Drawings, para qué y con qué base legal, qué proveedores intervienen, cuánto tiempo se guardan y cómo ejercer tus derechos.',
      intro: [
        'Esta política explica qué datos personales tratamos cuando visitas petsdrawings.com, compras en la tienda, encargas un retrato o nos escribes. Pedimos solo lo necesario para atenderte, y no vendemos tus datos ni los usamos para publicidad.',
      ],
      sections: [
        {
          heading: 'Responsable del tratamiento',
          blocks: [
            'El responsable de tus datos es:',
            { special: 'identity' },
            `Para cualquier cuestión sobre tus datos, escribe a ${MAIL}.`,
          ],
        },
        {
          heading: 'Qué datos tratamos y para qué',
          blocks: [
            { h: 'Compras en la tienda' },
            'Datos: nombre, email, teléfono, dirección de entrega y la nota que añadas al pedido. Si es un regalo, el nombre, la dirección y el teléfono de quien lo recibe, y el mensaje para la tarjeta: asegúrate de que a esa persona le parece bien que nos los des. Si recoges el pedido en un mercado, no necesitamos dirección. Si pides factura completa, tu NIF y tus datos de facturación. Guardamos también los productos, los importes, el medio de pago y la referencia del pago, pero nunca el número de tu tarjeta: lo recibe directamente Stripe o PayPal.',
            'Para qué: preparar y entregar el pedido, cobrarlo, emitir la factura, avisarte por email de su estado (confirmación, envío con número de seguimiento, reembolsos) y atender devoluciones y garantías. En el email del envío te invitamos a dejar una opinión.',
            'Base legal: el contrato de compra (art. 6.1.b del Reglamento General de Protección de Datos, RGPD) y nuestras obligaciones fiscales y contables (art. 6.1.c). La invitación a opinar se basa en nuestro interés legítimo en conocer tu experiencia (art. 6.1.f); basta con ignorarla.',
            { h: 'Tu cuenta de cliente' },
            'Datos: nombre, email y contraseña, que se guarda solo como hash y nunca en claro. Si los guardas, también teléfono, dirección de envío y datos de facturación. Mientras tienes una sesión iniciada, registramos la dirección IP y el navegador de esa sesión, por seguridad.',
            'Para qué: que veas tus pedidos y facturas, pidas factura con NIF y no tengas que repetir tus datos en cada compra. Base legal: el contrato de uso de la cuenta que aceptas al registrarte (art. 6.1.b RGPD).',
            { h: 'Encargos y mensajes' },
            'Datos: nombre, email y el mensaje; en los encargos, además, el tamaño, el número de mascotas o personas y las fotos que envíes. Las fotos de los encargos se guardan de forma privada y solo las ve Meili. Si nos escribes por email, WhatsApp o redes sociales, tratamos también lo que nos cuentes por esa vía.',
            'Para qué: contestarte, preparar el presupuesto y, si lo aceptas, dibujar y enviar el retrato. Base legal: las medidas previas al contrato que nos pides y el contrato del encargo (art. 6.1.b RGPD); para consultas generales, nuestro interés legítimo en responder a quien nos escribe (art. 6.1.f).',
            'Publicar el retrato: solo con tu permiso, Meili puede mostrar el retrato terminado y la foto de referencia en su web y en sus redes. Si en el retrato aparecen personas, hace falta también el permiso de cada una. Puedes retirarlo cuando quieras.',
            { h: 'Opiniones' },
            'Datos: el nombre con el que firmas, la ciudad y el nombre de tu mascota si los indicas, la valoración, el texto y las fotos. Las revisamos antes de publicarlas. Base legal: tu consentimiento al enviarla (art. 6.1.a RGPD); puedes pedirnos que la retiremos en cualquier momento.',
            { h: 'Protección de los formularios' },
            'Los formularios de contacto, encargo, opinión y cuenta comprueban señales de uso automatizado y limitan el número de envíos, para frenar el spam y los abusos. Para ello guardamos durante 30 días una huella (hash) de la dirección IP y del email, que no permite leerlos, y una versión abreviada del email (por ejemplo, «nomb***@correo.com»). Cuando está activada, se usa además la comprobación Turnstile de Cloudflare. Base legal: nuestro interés legítimo en proteger la web y a quienes la usan (art. 6.1.f RGPD).',
            { h: 'Medición de visitas' },
            `Solo si la aceptas en el aviso de la web. Registramos la página vista, el sitio del que vienes, los parámetros de campaña, el país y la región (deducidos de la conexión), el idioma, el tipo de dispositivo, el navegador, el sistema operativo y el tamaño de la ventana. No guardamos tu dirección IP ni tu nombre, y el identificador de la visita es aleatorio y desaparece al cerrar la pestaña. Base legal: tu consentimiento (art. 6.1.a RGPD y art. 22.2 de la Ley de Servicios de la Sociedad de la Información, LSSI). Más detalle en la [política de cookies](${page('es', 'cookies')}).`,
          ],
        },
        {
          heading: 'Con quién compartimos tus datos',
          blocks: [
            'Tus datos los ve Meili y, solo en lo necesario para cada tarea, estos proveedores, que los tratan por encargo nuestro y bajo contrato:',
            [
              'Vercel Inc. (Estados Unidos): aloja la web y ejecuta su servidor, que funciona en Fráncfort (Alemania).',
              'Aiven Oy (Finlandia): base de datos, en servidores de DigitalOcean en Ámsterdam (Países Bajos), con copias de seguridad cifradas.',
              'Cloudinary (Estados Unidos): guarda y sirve las imágenes, incluidas las fotos que envías con un encargo o una opinión.',
              'Resend (Estados Unidos): envía los emails de pedidos, envíos, presupuestos y cuenta.',
              'Stripe Payments Europe, Ltd. (Irlanda): pagos con tarjeta.',
              'PayPal (Europe) S.à r.l. et Cie, S.C.A. (Luxemburgo): pagos con PayPal.',
              'Sociedad Estatal Correos y Telégrafos, S.A., S.M.E. (España): entrega de los paquetes. Recibe el nombre, la dirección, el teléfono y el email de quien recibe el paquete.',
              'Cloudflare, Inc. (Estados Unidos): comprobación anti-bots Turnstile en los formularios, cuando está activada.',
            ],
            'Stripe y PayPal tratan además los datos del pago como responsables independientes, para sus propias obligaciones (por ejemplo, la prevención del fraude), según sus políticas de privacidad. Si pagas por Bizum o por transferencia, intervienen tu banco y el nuestro.',
            'Fuera de esto, solo comunicamos datos a la Agencia Tributaria, a juzgados o a otras autoridades cuando la ley nos obliga.',
          ],
        },
        {
          heading: 'Transferencias fuera del Espacio Económico Europeo',
          blocks: [
            'Vercel, Cloudinary, Resend y Cloudflare son empresas de Estados Unidos y pueden tratar datos allí; Stripe y PayPal pueden transferirlos a empresas de su grupo fuera del Espacio Económico Europeo. Esas transferencias se amparan en el Marco de Privacidad de Datos UE-EE. UU., cuando la empresa está adherida, o en las cláusulas contractuales tipo aprobadas por la Comisión Europea. La base de datos está en la Unión Europea.',
          ],
        },
        {
          heading: 'Cuánto tiempo guardamos los datos',
          blocks: [
            [
              'Pedidos y facturas: 6 años, como exige el art. 30 del Código de Comercio.',
              'Presupuestos de compra que no llegan a pagarse, con el NIF y la dirección que incluyan: se borran a los 30 días.',
              'Contenido de los emails que enviamos: se borra 90 días después del envío.',
              'Mensajes de contacto y solicitudes de encargo, con sus fotos: se borran 2 años después de la última actividad, salvo que estén ligados a un pedido, que sigue el plazo de los pedidos.',
              'Medición de visitas: se borra a los 13 meses.',
              'Registros de protección de los formularios: se borran a los 30 días.',
              'Opiniones: mientras estén publicadas, o hasta que nos pidas retirarlas.',
              'Cuenta de cliente: hasta que se borre. Puedes pedirlo en cualquier momento.',
              'Copias de seguridad cifradas de la base de datos: las diarias se guardan 35 días; la del día 1 de cada mes se guarda 6 años, porque contiene los registros contables (las facturas).',
            ],
            'Pasado el plazo, borramos los datos o los anonimizamos. Lo que se borra de la base de datos desaparece de las copias de seguridad a medida que estas caducan.',
          ],
        },
        {
          heading: 'Tus derechos',
          blocks: [
            'Puedes pedirnos en cualquier momento:',
            [
              'Acceder a los datos que tenemos sobre ti.',
              'Rectificarlos si son inexactos o están incompletos.',
              'Suprimirlos, salvo los que la ley nos obliga a conservar (por ejemplo, las facturas).',
              'Oponerte a un tratamiento basado en nuestro interés legítimo, o pedir que lo limitemos.',
              'Recibirlos en un formato de uso común para llevarlos a otro servicio (portabilidad).',
              'Retirar un consentimiento que nos hayas dado (a la medición de visitas, a una opinión o a la publicación de un retrato), sin que eso afecte a lo hecho antes.',
            ],
            `Escríbenos a ${MAIL} desde el email que usaste con nosotros, o explícanos cómo podemos comprobar que eres tú. Te respondemos en un plazo máximo de un mes.`,
            `Si crees que no hemos atendido bien tu solicitud, puedes reclamar ante la Agencia Española de Protección de Datos (${AEPD}).`,
          ],
        },
        {
          heading: 'Seguridad',
          blocks: [
            'La web funciona siempre cifrada (HTTPS). Las contraseñas se guardan como hash, las fotos de los encargos son privadas, solo las personas autorizadas entran en el panel de administración y las copias de seguridad están cifradas. Nunca vemos ni guardamos los datos de tu tarjeta.',
          ],
        },
        {
          heading: 'Menores',
          blocks: [
            'La tienda no está dirigida a menores de 14 años y no tratamos a sabiendas sus datos. Si tienes menos de 14 años, pide a tu madre, tu padre o tu tutor que haga el pedido o el encargo.',
          ],
        },
        {
          heading: 'Cambios en esta política',
          blocks: ['Si cambiamos algo importante, lo publicaremos aquí con la nueva fecha de actualización.'],
        },
      ],
    },
    en: {
      title: 'Privacy policy',
      description:
        'Who handles your data at Pets Drawings, why and on what legal basis, which providers are involved, how long data is kept and how to exercise your rights.',
      intro: [
        'This policy explains what personal data we handle when you visit petsdrawings.com, buy from the shop, commission a portrait or write to us. We only ask for what we need to serve you, and we never sell your data or use it for advertising.',
      ],
      sections: [
        {
          heading: 'Data controller',
          blocks: [
            'The controller of your data is:',
            { special: 'identity' },
            `For any question about your data, write to ${MAIL}.`,
          ],
        },
        {
          heading: 'What data we handle and why',
          blocks: [
            { h: 'Shop orders' },
            'Data: name, email, phone, delivery address and any note you add to the order. For a gift, the recipient’s name, address and phone, and the message for the card: please make sure they are happy for you to give them to us. If you pick the order up at a market, we need no address. If you ask for a full invoice, your tax ID and billing details. We also keep the products, the amounts, the payment method and the payment reference, but never your card number: that goes straight to Stripe or PayPal.',
            'Why: to prepare and deliver the order, take payment, issue the invoice, email you about its progress (confirmation, dispatch with a tracking number, refunds) and handle returns and guarantee claims. The dispatch email invites you to leave a review.',
            'Legal basis: the sales contract (art. 6.1.b of the General Data Protection Regulation, GDPR) and our tax and accounting obligations (art. 6.1.c). The review invitation relies on our legitimate interest in hearing about your experience (art. 6.1.f); you can simply ignore it.',
            { h: 'Your customer account' },
            'Data: name, email and password, which is stored only as a hash, never in plain text. If you save them, also phone, delivery address and billing details. While you are signed in, we record the IP address and browser of that session, for security.',
            'Why: so you can see your orders and invoices, request an invoice with your tax ID and avoid typing your details for every order. Legal basis: the account terms you accept when you register (art. 6.1.b GDPR).',
            { h: 'Commissions and messages' },
            'Data: name, email and your message; for a commission, also the size, the number of pets or people and the photos you send. Commission photos are stored privately and only Meili sees them. If you write by email, WhatsApp or social media, we also handle what you tell us there.',
            'Why: to reply, prepare the quote and, if you accept it, draw and send the portrait. Legal basis: the steps you ask us to take before a contract and the commission contract itself (art. 6.1.b GDPR); for general questions, our legitimate interest in answering people who write to us (art. 6.1.f).',
            'Showing the portrait: only with your permission, Meili may show the finished portrait and the reference photo on her website and social media. If people appear in the portrait, each of them must agree too. You can withdraw your permission at any time.',
            { h: 'Reviews' },
            'Data: the name you sign with, your town and your pet’s name if you give them, the rating, the text and the photos. We check reviews before publishing them. Legal basis: your consent when you send it (art. 6.1.a GDPR); you can ask us to take it down at any time.',
            { h: 'Form protection' },
            'The contact, commission, review and account forms look for signs of automated use and limit how often they can be sent, to stop spam and abuse. For this we keep, for 30 days, a fingerprint (hash) of the IP address and of the email that cannot be read back, and a shortened form of the email (for example “name***@mail.com”). When it is switched on, Cloudflare’s Turnstile check is used as well. Legal basis: our legitimate interest in protecting the website and the people who use it (art. 6.1.f GDPR).',
            { h: 'Visit measurement' },
            `Only if you accept it in the notice on the website. We record the page viewed, the site you came from, campaign parameters, country and region (worked out from the connection), language, device type, browser, operating system and window size. We do not store your IP address or your name, and the visit identifier is random and disappears when you close the tab. Legal basis: your consent (art. 6.1.a GDPR and art. 22.2 of the Spanish Information Society Services Act, LSSI). More detail in the [cookie policy](${page('en', 'cookies')}).`,
          ],
        },
        {
          heading: 'Who we share your data with',
          blocks: [
            'Your data is seen by Meili and, only as far as each task needs, by these providers, who process it on our behalf under contract:',
            [
              'Vercel Inc. (United States): hosts the website and runs its server, which operates in Frankfurt (Germany).',
              'Aiven Oy (Finland): database, on DigitalOcean servers in Amsterdam (Netherlands), with encrypted backups.',
              'Cloudinary (United States): stores and serves images, including the photos you send with a commission or a review.',
              'Resend (United States): sends the emails about orders, dispatch, quotes and your account.',
              'Stripe Payments Europe, Ltd. (Ireland): card payments.',
              'PayPal (Europe) S.à r.l. et Cie, S.C.A. (Luxembourg): PayPal payments.',
              'Sociedad Estatal Correos y Telégrafos, S.A., S.M.E. (Spain): parcel delivery. It receives the recipient’s name, address, phone and email.',
              'Cloudflare, Inc. (United States): the Turnstile anti-bot check on forms, when it is switched on.',
            ],
            'Stripe and PayPal also handle payment data as independent controllers, for their own obligations (fraud prevention, for example), under their own privacy policies. If you pay by Bizum or bank transfer, your bank and ours are involved.',
            'Beyond this, we only disclose data to the Spanish tax agency, courts or other authorities when the law requires it.',
          ],
        },
        {
          heading: 'Transfers outside the European Economic Area',
          blocks: [
            'Vercel, Cloudinary, Resend and Cloudflare are US companies and may process data there; Stripe and PayPal may transfer it to companies in their groups outside the European Economic Area. These transfers rely on the EU-US Data Privacy Framework, where the company has signed up to it, or on the standard contractual clauses approved by the European Commission. The database is in the European Union.',
          ],
        },
        {
          heading: 'How long we keep data',
          blocks: [
            [
              'Orders and invoices: 6 years, as required by art. 30 of the Spanish Commercial Code.',
              'Checkout quotes that are never paid, including any tax ID and address in them: deleted after 30 days.',
              'Contents of the emails we send: deleted 90 days after sending.',
              'Contact messages and commission requests, with their photos: deleted 2 years after the last activity, unless they are linked to an order, which follows the period for orders.',
              'Visit measurement: deleted after 13 months.',
              'Form protection records: deleted after 30 days.',
              'Reviews: while they are published, or until you ask us to take them down.',
              'Customer account: until it is deleted. You can ask for that at any time.',
              'Encrypted database backups: daily backups are kept for 35 days; the one from the 1st of each month is kept for 6 years, because it holds the accounting records (invoices).',
            ],
            'When a period ends, we delete or anonymise the data. Data erased from the database disappears from the backups as they expire.',
          ],
        },
        {
          heading: 'Your rights',
          blocks: [
            'At any time you can ask us to:',
            [
              'Give you access to the data we hold about you.',
              'Correct it if it is inaccurate or incomplete.',
              'Erase it, except what the law requires us to keep (invoices, for example).',
              'Stop a processing based on our legitimate interest, or restrict it.',
              'Give it to you in a commonly used format so you can take it elsewhere (portability).',
              'Withdraw a consent you gave us (to visit measurement, a review or showing a portrait), without affecting what was done before.',
            ],
            `Write to ${MAIL} from the email you used with us, or tell us how we can check it is you. We reply within one month at the latest.`,
            `If you think we have not handled your request properly, you can complain to the Spanish Data Protection Agency (${AEPD}).`,
          ],
        },
        {
          heading: 'Security',
          blocks: [
            'The website always runs encrypted (HTTPS). Passwords are stored as hashes, commission photos are private, only authorised people can enter the admin panel and backups are encrypted. We never see or store your card details.',
          ],
        },
        {
          heading: 'Children',
          blocks: [
            'The shop is not aimed at children under 14 and we do not knowingly handle their data. If you are under 14, ask a parent or guardian to place the order or the commission.',
          ],
        },
        {
          heading: 'Changes to this policy',
          blocks: ['If we change anything important, we will publish it here with the new update date.'],
        },
      ],
    },
  },

  cookies: {
    updated: UPDATED,
    es: {
      title: 'Política de cookies',
      description:
        'Cookies y almacenamiento del navegador en petsdrawings.com: lo necesario para carrito, compra y cuenta, y una medición de visitas propia si la aceptas.',
      intro: [
        'Usamos lo mínimo. No hay cookies de publicidad ni de redes sociales, ni herramientas de seguimiento de terceros. Además de cookies, la web guarda algunos datos en el almacenamiento de tu navegador (localStorage y sessionStorage). La ley los trata igual que a las cookies, así que aquí están todos.',
      ],
      sections: [
        {
          heading: 'Cookies necesarias',
          blocks: [
            'Hacen falta para que la web funcione, así que no piden consentimiento (art. 22.2 LSSI). Todas son propias, de petsdrawings.com:',
            [
              '`pd_cart_owner`: un identificador aleatorio que une tu carrito con su presupuesto y con la reserva de las piezas mientras pagas. Dura 400 días.',
              '`better-auth.session_token` (en la web publicada lleva delante `__Secure-`): mantiene abierta tu sesión de cliente o de administración. Solo existe si entras en una cuenta. Dura 30 días, se renueva al usar la web y se borra al cerrar sesión.',
              '`pd_flash`: lleva un aviso de un solo uso de una página a la siguiente, por ejemplo «te hemos enviado un enlace». Dura 2 minutos.',
            ],
          ],
        },
        {
          heading: 'Almacenamiento necesario del navegador',
          blocks: [
            'Se queda en tu dispositivo y no se envía a ningún sitio salvo cuando lo usas para comprar:',
            [
              '`petsdrawings.cart.v1` (localStorage): lo que hay en tu carrito.',
              '`petsdrawings.destination.v1` (localStorage): el país y el código postal, o el mercado de recogida, que elegiste para calcular el envío.',
              '`petsdrawings.checkout.v1` (localStorage): los datos que escribes al finalizar la compra (contacto, dirección y, si pides factura, NIF y datos de facturación), para no tener que repetirlos en este dispositivo. La nota del pedido se borra al pagar. En un ordenador compartido, borra los datos del sitio al terminar.',
              '`petsdrawings.coupon.v1` (localStorage): el código de un cupón que te llegó en un enlace, para aplicarlo al pagar. Se olvida a los 30 días.',
              '`pd-analytics` (localStorage): tu respuesta al aviso de medición, para no volver a preguntarte.',
              '`petsdrawings.orderAccess.v1` y `petsdrawings.commissionPayment.v1` (sessionStorage): la referencia y la clave de acceso del pedido que acabas de pagar, para mostrarte la confirmación. Se borran al cerrar la pestaña.',
            ],
            'Lo guardado en localStorage se queda hasta que lo borras desde el navegador, salvo lo que se indica.',
          ],
        },
        {
          heading: 'Medición de visitas, solo si la aceptas',
          blocks: [
            'Si pulsas «Aceptar» en el aviso, cada página que visitas envía a nuestro propio servidor la dirección de la página, el sitio del que vienes, los parámetros de campaña (`utm_source`, `utm_medium` y `utm_campaign`), el idioma, el tamaño de la ventana y un identificador aleatorio de la visita. El servidor añade el país y la región, que deduce de la conexión, y el tipo de dispositivo, el navegador y el sistema operativo. No guarda tu dirección IP.',
            [
              '`pd-visit` (sessionStorage): el identificador aleatorio de la visita, para contar juntas las páginas de una misma visita. Se borra al cerrar la pestaña, y el servidor solo guarda una huella (hash) de él.',
            ],
            'Los datos se guardan 13 meses en nuestra base de datos, solo los ve Meili y no se comparten con nadie. Si pulsas «Rechazar», no se envía nada.',
          ],
        },
        {
          heading: 'Servicios de terceros',
          blocks: [
            [
              'Pago: al pagar con tarjeta o con PayPal pasas a la página de Stripe o de PayPal, que usan sus propias cookies según sus políticas. En petsdrawings.com no cargamos sus scripts.',
              'Formularios: cuando está activada, la comprobación anti-bots Turnstile de Cloudflare se carga en los formularios de contacto, encargo, opinión y cuenta. Sirve solo para distinguir personas de robots y es necesaria para la seguridad del formulario.',
              'Imágenes: las fotos de la web se sirven desde Cloudinary, que recibe la petición de tu navegador como cualquier servidor. No usamos ninguna de sus herramientas de seguimiento.',
              'Instagram, Facebook y WhatsApp son solo enlaces: no cargan nada hasta que pulsas en ellos.',
            ],
          ],
        },
        {
          heading: 'Cambiar tu elección',
          id: 'cambiar',
          blocks: [
            'Puedes cambiar de opinión cuando quieras: vuelve a abrir el aviso y elige otra vez.',
            { special: 'analyticsChoice' },
            'También puedes borrar las cookies y los datos del sitio desde la configuración de tu navegador. Si lo haces, se vaciará el carrito, se cerrará tu sesión y volverá a salir el aviso de medición.',
          ],
        },
      ],
    },
    en: {
      title: 'Cookie policy',
      description:
        'The cookies and browser storage used on petsdrawings.com: only what the cart, checkout and accounts need, plus our own visit measurement if you accept it.',
      intro: [
        'We use as little as possible. There are no advertising or social media cookies, and no third-party tracking tools. Besides cookies, the website keeps some data in your browser’s storage (localStorage and sessionStorage). The law treats it like cookies, so it is all listed here.',
      ],
      sections: [
        {
          heading: 'Necessary cookies',
          blocks: [
            'The website needs these to work, so they do not ask for consent (art. 22.2 LSSI). All of them are our own, set by petsdrawings.com:',
            [
              '`pd_cart_owner`: a random identifier that links your cart to its quote and to the reservation of the pieces while you pay. Lasts 400 days.',
              '`better-auth.session_token` (on the live website it is prefixed with `__Secure-`): keeps you signed in to a customer or admin account. It only exists if you sign in. Lasts 30 days, is renewed as you use the site and is deleted when you sign out.',
              '`pd_flash`: carries a one-time message from one page to the next, such as “we have sent you a link”. Lasts 2 minutes.',
            ],
          ],
        },
        {
          heading: 'Necessary browser storage',
          blocks: [
            'It stays on your device and is only sent anywhere when you use it to place an order:',
            [
              '`petsdrawings.cart.v1` (localStorage): what is in your cart.',
              '`petsdrawings.destination.v1` (localStorage): the country and postcode, or the pickup market, you chose to work out shipping.',
              '`petsdrawings.checkout.v1` (localStorage): what you type at checkout (contact, address and, if you ask for an invoice, tax ID and billing details), so you need not type it again on this device. The order note is deleted once you pay. On a shared computer, clear the site’s data when you finish.',
              '`petsdrawings.coupon.v1` (localStorage): a coupon code that came in a link, to apply it at checkout. Forgotten after 30 days.',
              '`pd-analytics` (localStorage): your answer to the measurement notice, so we do not ask again.',
              '`petsdrawings.orderAccess.v1` and `petsdrawings.commissionPayment.v1` (sessionStorage): the reference and access key of the order you have just paid, to show you the confirmation. Deleted when you close the tab.',
            ],
            'What is kept in localStorage stays until you clear it in your browser, unless stated otherwise.',
          ],
        },
        {
          heading: 'Visit measurement, only if you accept it',
          blocks: [
            'If you press “Accept” in the notice, each page you visit sends to our own server the page address, the site you came from, campaign parameters (`utm_source`, `utm_medium` and `utm_campaign`), language, window size and a random visit identifier. The server adds the country and region, worked out from the connection, and the device type, browser and operating system. It does not store your IP address.',
            [
              '`pd-visit` (sessionStorage): the random visit identifier, so the pages of one visit are counted together. Deleted when you close the tab; the server only keeps a fingerprint (hash) of it.',
            ],
            'The data is kept for 13 months in our database, only Meili sees it and it is not shared with anyone. If you press “Decline”, nothing is sent.',
          ],
        },
        {
          heading: 'Third-party services',
          blocks: [
            [
              'Payment: when you pay by card or with PayPal you move to Stripe’s or PayPal’s page, which use their own cookies under their own policies. We do not load their scripts on petsdrawings.com.',
              'Forms: when it is switched on, Cloudflare’s Turnstile anti-bot check loads on the contact, commission, review and account forms. It only tells people from robots and is needed to keep the form secure.',
              'Images: the website’s photos are served from Cloudinary, which receives your browser’s request like any server. We use none of its tracking tools.',
              'Instagram, Facebook and WhatsApp are plain links: nothing loads until you click them.',
            ],
          ],
        },
        {
          heading: 'Change your choice',
          id: 'change',
          blocks: [
            'You can change your mind at any time: open the notice again and choose once more.',
            { special: 'analyticsChoice' },
            'You can also clear cookies and site data in your browser settings. If you do, the cart empties, you are signed out and the measurement notice appears again.',
          ],
        },
      ],
    },
  },

  terms: {
    updated: UPDATED,
    es: {
      title: 'Condiciones de venta',
      description:
        'Condiciones de compra en Pets Drawings: quién vende, precios con IVA, pago, entrega, desistimiento en 14 días, garantía y retratos por encargo.',
      intro: [
        `Estas condiciones regulan las compras en petsdrawings.com y los encargos de retratos. Al pagar un pedido o un encargo las aceptas, junto con la [política de privacidad](${page('es', 'privacy')}). Se aplican las vigentes en la fecha del pedido.`,
      ],
      sections: [
        {
          heading: 'Quién vende',
          blocks: [{ special: 'identity' }],
        },
        {
          heading: 'Qué vendemos',
          blocks: [
            [
              'Productos de la tienda: tarjetas de felicitación, posavasos, tazas, adornos, llaveros y láminas con los retratos de mascotas de Meili. Las fotos muestran el producto real, aunque el color puede variar un poco según tu pantalla.',
              'Retratos por encargo: dibujos originales a lápiz de grafito, hechos a mano a partir de tus fotos (ver [Retratos por encargo](#encargos)).',
            ],
          ],
        },
        {
          heading: 'Precios e impuestos',
          blocks: [
            [
              'Los precios están en euros (EUR) e incluyen el IVA cuando corresponde.',
              'Canarias, Ceuta y Melilla están fuera del IVA español, y los envíos fuera de la Unión Europea son exportaciones: en esos casos descontamos el IVA del precio y lo ves en el resumen antes de pagar. En destino pueden cobrarse impuestos de importación, aranceles y gastos de aduana, que paga quien recibe el paquete.',
              'Los gastos de envío dependen del destino y del peso del paquete, y se muestran antes de pagar.',
              'Si usas un cupón, el descuento aparece en el resumen antes de pagar. Cada cupón tiene sus condiciones (fechas, importe mínimo, productos o destinos).',
            ],
          ],
        },
        {
          heading: 'Cómo se hace un pedido',
          blocks: [
            [
              'Añades las piezas al carrito.',
              'En «Finalizar compra» escribes tus datos y eliges dónde lo enviamos o en qué mercado lo recoges. Ves el coste y el plazo estimado del envío y el total.',
              'Antes de abrir el pago comprobamos los precios y que las piezas siguen disponibles. Hasta que pagas puedes volver atrás y corregir cualquier dato.',
              'Pagas en la página segura de Stripe (tarjeta) o de PayPal.',
              'El contrato queda cerrado cuando se confirma el pago. Te enviamos un email de confirmación con la referencia del pedido.',
            ],
            `Guardamos el pedido y su factura; puedes verlos en [tu cuenta](${page('es', 'account')}) o pedirnos una copia. El contrato puede hacerse en español o en inglés. Si por un error no pudiéramos servir un pedido ya pagado, te avisaríamos y te devolveríamos todo el importe.`,
          ],
        },
        {
          heading: 'Pago y factura',
          blocks: [
            [
              'En la web: con tarjeta, a través de Stripe, o con PayPal. Los datos de la tarjeta los recibe directamente el proveedor de pago; nosotros nunca los vemos.',
              'En los encargos y en los pedidos por teléfono también puedes pagar por Bizum o por transferencia. Preparamos el pedido cuando recibimos el pago.',
              'En los mercados se paga en efectivo, con tarjeta o por Bizum.',
            ],
            'Con cada pedido pagado emitimos factura. Sin NIF es una factura simplificada; si necesitas una completa, marca «Necesito factura con NIF o CIF» al pagar, o pídela después desde tu cuenta o por email. Una factura emitida no se modifica: si hay que corregirla, emitimos una factura rectificativa.',
          ],
        },
        {
          heading: 'Envío y entrega',
          blocks: [
            `Enviamos desde España con Correos, o puedes recoger el pedido en un mercado. Zonas, costes, plazos y recogida: [Envíos y devoluciones](${page('es', 'shipping')}).`,
            'Si no se indica otro plazo, entregamos como máximo 30 días naturales después del pedido. El producto viaja bajo nuestra responsabilidad hasta que lo recibes.',
          ],
        },
        {
          heading: 'Derecho de desistimiento',
          id: 'desistimiento',
          blocks: [
            returnsPolicy.es,
            `Cómo desistir, paso a paso, y el formulario de desistimiento: [Envíos y devoluciones](${page('es', 'shipping', '#desistimiento')}).`,
          ],
        },
        {
          heading: 'Garantía',
          blocks: [
            'Todos los productos, también los retratos por encargo, tienen la garantía legal: respondemos de cualquier falta de conformidad que aparezca en los tres años siguientes a la entrega.',
            `Si algo llega defectuoso o dañado, escríbenos a ${MAIL} con una foto. Pagamos nosotros la devolución y puedes elegir que lo cambiemos o lo reparemos; si eso no es posible, te rebajamos el precio o te devolvemos el dinero.`,
          ],
        },
        {
          heading: 'Retratos por encargo',
          id: 'encargos',
          blocks: [
            [
              `Le cuentas a Meili lo que quieres desde [Encargos](${page('es', 'commissions')}) o por email, y le envías las fotos.`,
              'Meili te responde por email con un presupuesto: el retrato, el precio con IVA incluido y un enlace para pagarlo, válido hasta la fecha que se indica. Los precios de la página de encargos son orientativos.',
              'El encargo queda confirmado cuando pagas el presupuesto completo, con el envío según tu destino. Puedes pagar con tarjeta, PayPal, Bizum o transferencia.',
              'El plazo se acuerda con el presupuesto. Si necesitas el retrato para una fecha, díselo antes de pagar.',
              'Al ser una obra hecha según tus indicaciones, no tiene derecho de desistimiento (art. 103 c TRLGDCU). Sí tiene la garantía legal si llega dañada o con un defecto.',
              'Recibes el dibujo original. Meili conserva los derechos de autor, y solo lo mostrará en su web o en sus redes con tu permiso.',
            ],
          ],
        },
        {
          heading: 'Propiedad intelectual',
          blocks: [
            'Todas las obras, fotos y textos de la web son © Meili Stringfellow. Al comprar un producto o un retrato te llevas el objeto, no los derechos de autor: no puedes reproducirlo, venderlo ni usarlo con fines comerciales sin su permiso por escrito. Enseñarlo y compartir fotos de él a título personal, por supuesto, sí.',
            'Al enviarnos fotos para un encargo, nos confirmas que puedes usarlas, y nos autorizas a usarlas solo para hacer tu retrato.',
          ],
        },
        {
          heading: 'Cuentas de cliente',
          blocks: [
            `Puedes comprar sin cuenta. Si creas una, mantén tu contraseña en secreto. Cómo funciona: [Ayuda con tu compra y tu cuenta](${page('es', 'accountHelp')}).`,
          ],
        },
        {
          heading: 'Opiniones',
          blocks: [
            'Cada pedido trae un enlace personal para opinar. Esas opiniones se marcan como «Compra verificada»; si el pedido se reembolsa por completo, la marca se quita. Meili también publica opiniones que le dan por otras vías, como en un mercado, y esas no llevan la marca.',
            'Revisamos todas antes de publicarlas. No publicamos las que no hablan del producto o del encargo, las que incluyen datos de otras personas y las ofensivas.',
          ],
        },
        {
          heading: 'Atención al cliente y reclamaciones',
          blocks: [
            `Para cualquier duda, incidencia o reclamación, escríbenos a ${MAIL} o por WhatsApp. Te responderemos lo antes posible.`,
            'Si no llegamos a un acuerdo, puedes acudir a los servicios de consumo de tu ayuntamiento o de tu comunidad autónoma.',
          ],
        },
        {
          heading: 'Ley aplicable',
          blocks: [
            'Estas condiciones se rigen por la ley española. Si eres consumidor, mantienes la protección que te den las leyes de tu país de residencia y puedes reclamar ante los juzgados de tu domicilio.',
          ],
        },
      ],
    },
    en: {
      title: 'Terms of sale',
      description:
        'Terms for buying from Pets Drawings: who sells, prices with VAT, payment, delivery, the 14-day right of withdrawal, guarantee and commissions.',
      intro: [
        `These terms cover purchases on petsdrawings.com and portrait commissions. When you pay for an order or a commission you accept them, together with the [privacy policy](${page('en', 'privacy')}). The terms in force on the date of the order apply.`,
      ],
      sections: [
        {
          heading: 'Who sells',
          blocks: [{ special: 'identity' }],
        },
        {
          heading: 'What we sell',
          blocks: [
            [
              'Shop products: greeting cards, coasters, mugs, ornaments, keyrings and prints of Meili’s pet portraits. The photos show the real product, although colours may look slightly different on your screen.',
              'Custom portraits (commissions): original graphite pencil drawings, made by hand from your photos (see [Custom portraits](#commissions)).',
            ],
          ],
        },
        {
          heading: 'Prices and taxes',
          blocks: [
            [
              'Prices are in euros (EUR) and include VAT where it applies.',
              'The Canary Islands, Ceuta and Melilla are outside Spanish VAT, and shipments outside the European Union are exports: in those cases we take the VAT off the price, and you see it in the summary before paying. At the destination, import taxes, duties and customs fees may be charged, which the recipient pays.',
              'Shipping costs depend on the destination and the parcel’s weight, and are shown before you pay.',
              'If you use a coupon, the discount appears in the summary before you pay. Each coupon has its own conditions (dates, minimum amount, products or destinations).',
            ],
          ],
        },
        {
          heading: 'How an order works',
          blocks: [
            [
              'You add pieces to the cart.',
              'At checkout you enter your details and choose where we send it or at which market you collect it. You see the shipping cost, the estimated delivery time and the total.',
              'Before opening payment we check prices and that the pieces are still available. Until you pay, you can go back and correct any detail.',
              'You pay on Stripe’s (card) or PayPal’s secure page.',
              'The contract is made when payment is confirmed. We email you a confirmation with the order reference.',
            ],
            `We keep the order and its invoice; you can see them in [your account](${page('en', 'account')}) or ask us for a copy. The contract can be made in Spanish or English. If, through an error, we could not fulfil an order you have paid for, we would tell you and refund the full amount.`,
          ],
        },
        {
          heading: 'Payment and invoice',
          blocks: [
            [
              'On the website: by card, through Stripe, or with PayPal. Card details go straight to the payment provider; we never see them.',
              'For commissions and phone orders you can also pay by Bizum or bank transfer. We prepare the order once the payment arrives.',
              'At markets you can pay in cash, by card or by Bizum.',
            ],
            'Every paid order gets an invoice. Without a tax ID it is a simplified invoice; if you need a full one, tick “I need an invoice with my tax ID” at checkout, or ask for it later from your account or by email. An issued invoice is never changed: if it needs correcting, we issue a corrective invoice.',
          ],
        },
        {
          heading: 'Shipping and delivery',
          blocks: [
            `We ship from Spain with Correos, or you can collect the order at a market. Zones, costs, delivery times and pickup: [Shipping & returns](${page('en', 'shipping')}).`,
            'Unless another time is stated, we deliver within 30 calendar days of the order at the latest. The product travels at our risk until you receive it.',
          ],
        },
        {
          heading: 'Right of withdrawal',
          id: 'withdrawal',
          blocks: [
            returnsPolicy.en,
            `How to withdraw, step by step, and the withdrawal form: [Shipping & returns](${page('en', 'shipping', '#withdrawal')}).`,
          ],
        },
        {
          heading: 'Guarantee',
          blocks: [
            'All products, commissioned portraits included, carry the legal guarantee: we are responsible for any lack of conformity that appears within three years of delivery.',
            `If something arrives defective or damaged, write to ${MAIL} with a photo. We pay for the return and you can choose a replacement or a repair; if neither is possible, we reduce the price or refund you.`,
          ],
        },
        {
          heading: 'Custom portraits',
          id: 'commissions',
          blocks: [
            [
              `You tell Meili what you would like through [Commissions](${page('en', 'commissions')}) or by email, and send her the photos.`,
              'Meili replies by email with a quote: the portrait, the price with VAT included and a link to pay for it, valid until the date given. Prices on the commissions page are a guide.',
              'The commission is confirmed when you pay the full quote, with shipping for your destination. You can pay by card, PayPal, Bizum or bank transfer.',
              'The delivery time is agreed with the quote. If you need the portrait by a certain date, tell her before you pay.',
              'As the work is made to your specification, there is no right of withdrawal (art. 103 c TRLGDCU). The legal guarantee does apply if it arrives damaged or defective.',
              'You receive the original drawing. Meili keeps the copyright, and will only show it on her website or social media with your permission.',
            ],
          ],
        },
        {
          heading: 'Copyright',
          blocks: [
            'All artworks, photos and texts on the website are © Meili Stringfellow. Buying a product or a portrait gives you the object, not the copyright: you may not reproduce it, sell it or use it commercially without her written permission. Showing it and sharing photos of it for personal use is, of course, fine.',
            'By sending us photos for a commission, you confirm you may use them, and you allow us to use them only to make your portrait.',
          ],
        },
        {
          heading: 'Customer accounts',
          blocks: [
            `You can buy without an account. If you create one, keep your password secret. How it works: [Help with orders and your account](${page('en', 'accountHelp')}).`,
          ],
        },
        {
          heading: 'Reviews',
          blocks: [
            'Every order comes with a personal link to leave a review. Those reviews are marked “Verified purchase”; if the order is refunded in full, the mark is removed. Meili also publishes reviews given to her in other ways, at a market for example, and those carry no mark.',
            'We check every review before publishing it. We do not publish reviews that are not about the product or the commission, that include other people’s personal data, or that are offensive.',
          ],
        },
        {
          heading: 'Customer service and complaints',
          blocks: [
            `For any question, problem or complaint, write to ${MAIL} or on WhatsApp. We will reply as soon as we can.`,
            'If we cannot reach an agreement, you can turn to the consumer services of your town council or regional government in Spain, or to the consumer authority where you live.',
          ],
        },
        {
          heading: 'Applicable law',
          blocks: [
            'These terms are governed by Spanish law. As a consumer, you keep the protection given by the law of your country of residence and may bring a claim before the courts where you live.',
          ],
        },
      ],
    },
  },

  shipping: {
    updated: UPDATED,
    es: {
      title: 'Envíos y devoluciones',
      description:
        'Envíos desde España con Correos, coste y plazo antes de pagar, recogida en mercados, aduanas, devoluciones en 14 días y formulario de desistimiento.',
      intro: ['Meili prepara y empaqueta cada pedido en su estudio, en España, y lo envía con Correos.'],
      sections: [
        {
          heading: 'Zonas de envío',
          blocks: [
            'El coste depende de la zona de destino y del peso del paquete. En España distinguimos la Península, las Islas Baleares, y Canarias, Ceuta y Melilla.',
            `Fuera de España enviamos a los países que aparecen en el selector de país al finalizar la compra. Si el tuyo no está, escríbenos a ${MAIL}.`,
          ],
        },
        {
          heading: 'Coste y plazo, antes de pagar',
          blocks: [
            'Cuando eliges el destino, en el carrito o al finalizar la compra, ves el coste del envío, el plazo de entrega estimado de tu zona y el total antes de pagar. Algunas zonas tienen envío gratis a partir de un importe; si es tu caso, el carrito te dice cuánto falta. En Navidad te indicamos también hasta qué día puedes pedir para recibirlo a tiempo.',
            'Los plazos son estimaciones del transporte. Si no se indica otro plazo, entregamos como máximo 30 días naturales después del pedido. Si no pudiéramos cumplirlo, te avisaríamos y, si lo prefieres, cancelaríamos el pedido con reembolso completo.',
          ],
        },
        {
          heading: 'Seguimiento',
          blocks: [
            'Cuando sale el paquete te enviamos un email con el número de seguimiento de Correos. Si tienes cuenta, también lo ves en tus pedidos.',
          ],
        },
        {
          heading: 'Recoger en un mercado',
          id: 'recogida',
          blocks: [
            `Si Meili va a estar en un mercado que admite recogida, puedes elegirlo como destino al finalizar la compra: no pagas envío ni hace falta dirección. Recoges el pedido en su puesto durante los días del mercado, con la referencia del pedido. Los mercados y sus fechas están en [Dónde estaré](${page('es', 'markets')}).`,
            'Como se entrega en España, un pedido recogido en un mercado lleva IVA español.',
          ],
        },
        {
          heading: 'Regalos',
          blocks: [
            'Puedes enviar un pedido como regalo a otra dirección, con un mensaje que imprimimos en una nota dentro del paquete. El paquete nunca lleva precios.',
          ],
        },
        {
          heading: 'Aduanas e impuestos',
          blocks: [
            'Canarias, Ceuta y Melilla están fuera del IVA español, y los envíos fuera de la Unión Europea son exportaciones: en ambos casos descontamos el IVA del precio antes de pagar.',
            'Al llegar, la aduana o el transportista pueden cobrar a quien recibe el paquete impuestos de importación (como el IGIC en Canarias o el IPSI en Ceuta y Melilla), aranceles y gastos de gestión. No están incluidos en el precio porque dependen del destino.',
          ],
        },
        {
          heading: 'Si hay un problema con la entrega',
          blocks: [
            'Si el paquete llega dañado, guarda el embalaje y escríbenos con fotos lo antes posible. Si se pierde por el camino, te enviamos el pedido de nuevo o te devolvemos el dinero. Si vuelve a nosotros porque no se pudo entregar, te escribimos para acordar cómo seguir.',
          ],
        },
        {
          heading: 'Devoluciones',
          id: 'devoluciones',
          blocks: [
            returnsPolicy.es,
            'Lo que compras en persona en un mercado no es una venta a distancia, así que no tiene derecho legal de desistimiento, aunque sí la garantía legal. Si recoges en un mercado un pedido hecho en la web, sí tienes los 14 días.',
            `Garantía de los productos: [Condiciones de venta](${page('es', 'terms')}).`,
          ],
        },
        {
          heading: 'Cómo desistir',
          id: 'desistimiento',
          blocks: [
            [
              `Dinos que desistes antes de que terminen los 14 días: basta con un email a ${MAIL} con la referencia del pedido. Puedes usar el formulario de abajo, pero no es obligatorio.`,
              'Si el pedido traía varios productos entregados por separado, los 14 días cuentan desde que recibes el último.',
              'Al responderte te confirmamos la dirección de devolución. Envíanos el producto bien embalado y con todo lo que traía, como máximo 14 días después de comunicarnos que desistes.',
              'Solo respondes de la pérdida de valor del producto si lo has manipulado más de lo necesario para comprobar su naturaleza, sus características y su funcionamiento.',
            ],
          ],
        },
        {
          heading: 'Formulario de desistimiento',
          blocks: [{ special: 'withdrawalForm' }],
        },
      ],
    },
    en: {
      title: 'Shipping & returns',
      description:
        'Shipping from Spain with Correos, cost and delivery time before you pay, market pickup, customs, 14-day returns and the withdrawal form.',
      intro: ['Meili prepares and packs every order in her studio in Spain and sends it with Correos.'],
      sections: [
        {
          heading: 'Shipping zones',
          blocks: [
            'The cost depends on the destination zone and the parcel’s weight. Within Spain we distinguish the mainland, the Balearic Islands, and the Canary Islands, Ceuta and Melilla.',
            `Outside Spain we ship to the countries listed in the country selector at checkout. If yours is not there, write to ${MAIL}.`,
          ],
        },
        {
          heading: 'Cost and delivery time, before you pay',
          blocks: [
            'When you choose the destination, in the cart or at checkout, you see the shipping cost, the estimated delivery time for your zone and the total before you pay. Some zones have free shipping above an amount; if yours does, the cart tells you how much is left. At Christmas we also show the last day to order in time.',
            'Delivery times are carrier estimates. Unless another time is stated, we deliver within 30 calendar days of the order at the latest. If we could not, we would tell you and, if you prefer, cancel the order with a full refund.',
          ],
        },
        {
          heading: 'Tracking',
          blocks: [
            'When the parcel leaves we email you the Correos tracking number. If you have an account, you also see it in your orders.',
          ],
        },
        {
          heading: 'Collect at a market',
          id: 'pickup',
          blocks: [
            `If Meili will be at a market that allows pickup, you can choose it as the destination at checkout: no shipping cost and no address needed. You collect the order at her stall during the market days, with your order reference. The markets and their dates are on [Where to find me](${page('en', 'markets')}).`,
            'As it is handed over in Spain, an order collected at a market includes Spanish VAT.',
          ],
        },
        {
          heading: 'Gifts',
          blocks: [
            'You can send an order as a gift to another address, with a message we print on a note inside the parcel. The parcel never shows prices.',
          ],
        },
        {
          heading: 'Customs and taxes',
          blocks: [
            'The Canary Islands, Ceuta and Melilla are outside Spanish VAT, and shipments outside the European Union are exports: in both cases we take the VAT off the price before you pay.',
            'On arrival, customs or the carrier may charge the recipient import taxes (such as IGIC in the Canary Islands or IPSI in Ceuta and Melilla), duties and handling fees. They are not included in the price because they depend on the destination.',
          ],
        },
        {
          heading: 'If something goes wrong with delivery',
          blocks: [
            'If the parcel arrives damaged, keep the packaging and write to us with photos as soon as you can. If it is lost on the way, we send the order again or refund you. If it comes back to us because it could not be delivered, we will write to agree how to proceed.',
          ],
        },
        {
          heading: 'Returns',
          id: 'returns',
          blocks: [
            returnsPolicy.en,
            'What you buy in person at a market is not a distance sale, so it has no legal right of withdrawal, though the legal guarantee applies. If you collect a web order at a market, you do have the 14 days.',
            `Product guarantee: [Terms of sale](${page('en', 'terms')}).`,
          ],
        },
        {
          heading: 'How to withdraw',
          id: 'withdrawal',
          blocks: [
            [
              `Tell us you are withdrawing before the 14 days are up: an email to ${MAIL} with the order reference is enough. You may use the form below, but you do not have to.`,
              'If the order had several products delivered separately, the 14 days run from when you receive the last one.',
              'When we reply, we confirm the return address. Send the product back well packed and with everything it came with, within 14 days of telling us you are withdrawing.',
              'You are only liable for any loss in value if you handled the product more than needed to check its nature, characteristics and functioning.',
            ],
          ],
        },
        {
          heading: 'Withdrawal form',
          blocks: [{ special: 'withdrawalForm' }],
        },
      ],
    },
  },

  accountHelp: {
    updated: UPDATED,
    es: {
      title: 'Ayuda con tu compra y tu cuenta',
      description:
        'Cómo comprar con o sin cuenta en Pets Drawings, ver tus pedidos y facturas, pedir factura con NIF, recuperar la contraseña y borrar tu cuenta.',
      intro: ['Puedes comprar como invitado o con una cuenta de cliente. Aquí tienes cómo funciona cada opción.'],
      sections: [
        {
          heading: 'Comprar sin cuenta',
          blocks: [
            'No necesitas cuenta para comprar. Al finalizar la compra escribes tu email y tus datos de envío, y te llega por email la confirmación con la referencia del pedido.',
            `Justo después de pagar, la página de confirmación te lleva al estado del pedido en ese mismo navegador. Más adelante, crea una cuenta con el mismo email para ver tus pedidos, o escríbenos a ${MAIL} con la referencia.`,
          ],
        },
        {
          heading: 'Crear una cuenta',
          blocks: [
            `En [Crear cuenta](${page('es', 'accountRegister')}) escribe tu nombre, tu email y una contraseña de al menos 8 caracteres, y acepta la [política de privacidad](${page('es', 'privacy')}). Te enviamos un enlace para confirmar el email; la cuenta queda lista cuando lo abres.`,
          ],
        },
        {
          heading: 'Qué puedes hacer con tu cuenta',
          blocks: [
            [
              'Ver tus pedidos, su estado y el número de seguimiento. También aparecen los que hiciste sin cuenta con el mismo email, una vez confirmado.',
              'Descargar tus facturas y pedir factura completa con tu NIF.',
              'Guardar tu nombre, teléfono, dirección y datos de facturación para que la compra se rellene sola.',
            ],
          ],
        },
        {
          heading: 'Entrar y recuperar la contraseña',
          blocks: [
            `Inicia sesión en [Entrar](${page('es', 'accountSignIn')}). Si olvidaste la contraseña, pide un enlace en [Recuperar contraseña](${page('es', 'accountForgot')}): vale durante una hora. Al cambiar la contraseña se cierran las demás sesiones abiertas.`,
            'La sesión se mantiene 30 días. En un ordenador compartido, cierra sesión al terminar.',
          ],
        },
        {
          heading: 'Facturas',
          blocks: [
            'Cada pedido pagado lleva factura. Sin NIF es una factura simplificada, que sirve como justificante. Para una factura completa, marca «Necesito factura con NIF o CIF» al pagar, o pídela después desde el pedido en tu cuenta.',
            `Si compraste sin cuenta y necesitas factura completa, escríbenos a ${MAIL} con la referencia del pedido y tus datos fiscales.`,
          ],
        },
        {
          heading: 'Borrar tu cuenta',
          blocks: [
            `Escríbenos a ${MAIL} desde el email de la cuenta y la borramos. Se borran tu perfil y los datos que guardaste. Los pedidos y las facturas se conservan el tiempo que exige la ley (6 años), como explica la [política de privacidad](${page('es', 'privacy')}).`,
          ],
        },
        {
          heading: 'Acceso de administración',
          blocks: ['El acceso de administración es solo para el panel privado de la artista. No lo necesitas para comprar.'],
        },
      ],
    },
    en: {
      title: 'Help with orders and your account',
      description:
        'Buying from Pets Drawings with or without an account: your orders and invoices, invoices with a tax ID, password resets and deleting your account.',
      intro: ['You can buy as a guest or with a customer account. Here is how each works.'],
      sections: [
        {
          heading: 'Buying without an account',
          blocks: [
            'You do not need an account to buy. At checkout you enter your email and delivery details, and you receive an email confirmation with the order reference.',
            `Right after paying, the confirmation page takes you to the order status in that same browser. Later on, create an account with the same email to see your orders, or write to ${MAIL} with the reference.`,
          ],
        },
        {
          heading: 'Creating an account',
          blocks: [
            `On [Create an account](${page('en', 'accountRegister')}) enter your name, your email and a password of at least 8 characters, and accept the [privacy policy](${page('en', 'privacy')}). We send you a link to confirm your email; the account is ready once you open it.`,
          ],
        },
        {
          heading: 'What your account does',
          blocks: [
            [
              'Shows your orders, their status and the tracking number, including those you placed without an account using the same email, once it is confirmed.',
              'Lets you download your invoices and request a full invoice with your tax ID.',
              'Saves your name, phone, address and billing details so checkout fills itself in.',
            ],
          ],
        },
        {
          heading: 'Signing in and resetting your password',
          blocks: [
            `Sign in on the [sign-in page](${page('en', 'accountSignIn')}). If you forgot your password, ask for a link on [Reset password](${page('en', 'accountForgot')}): it works for one hour. Changing your password signs out your other sessions.`,
            'Your session stays open for 30 days. On a shared computer, sign out when you finish.',
          ],
        },
        {
          heading: 'Invoices',
          blocks: [
            'Every paid order gets an invoice. Without a tax ID it is a simplified invoice, valid as a receipt. For a full invoice, tick “I need an invoice with my tax ID” at checkout, or request it later from the order in your account.',
            `If you bought without an account and need a full invoice, write to ${MAIL} with the order reference and your tax details.`,
          ],
        },
        {
          heading: 'Deleting your account',
          blocks: [
            `Write to ${MAIL} from the account’s email and we delete it. Your profile and saved details are erased. Orders and invoices are kept for as long as the law requires (6 years), as the [privacy policy](${page('en', 'privacy')}) explains.`,
          ],
        },
        {
          heading: 'Admin access',
          blocks: ['Admin access is only for the artist’s private panel. You do not need it to buy.'],
        },
      ],
    },
  },
};

// ——— Rendering helpers ———

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;

/** A line of text split into plain text, links and names in code. */
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at) });
    if (match[1] !== undefined) parts.push({ text: match[1], href: match[2] });
    else parts.push({ text: match[3]!, code: true });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** "Retratos por encargo" → "retratos-por-encargo". */
export function sectionId(heading: string): string {
  return heading
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function renderBlock(block: Block): RenderedBlock {
  if (typeof block === 'string') return { type: 'p', parts: inlineParts(block) };
  if (Array.isArray(block)) return { type: 'list', items: block.map(inlineParts) };
  if ('h' in block) return { type: 'h3', text: block.h };
  return { type: block.special };
}

export function getLegalDoc(pageKey: LegalPageKey, locale: Locale) {
  const doc = legalDocs[pageKey];
  const content = doc[locale];
  const sections: RenderedSection[] = content.sections.map((section) => ({
    id: section.id ?? sectionId(section.heading),
    heading: section.heading,
    blocks: section.blocks.map(renderBlock),
  }));
  const specials = new Set(sections.flatMap((s) => s.blocks.map((b) => b.type)));
  return {
    title: content.title,
    description: content.description,
    updated: doc.updated,
    intro: content.intro.map(inlineParts),
    sections,
    /** The page shows who sells, so the shop settings must be read. */
    needsIdentity: specials.has('identity') || specials.has('withdrawalForm'),
  };
}

/** "28 de noviembre de 2026" / "28 November 2026". */
export function formatUpdated(updated: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${updated}T00:00:00Z`),
  );
}

/** Street, postcode and town, then the country; null when none is set. */
export function postalAddress(identity: SellerIdentity, locale: Locale): string | null {
  const town = [identity.postalCode, identity.city].filter(Boolean).join(' ');
  const parts = [identity.address, town].filter(Boolean);
  if (parts.length === 0) return null;
  return [...parts, locale === 'es' ? 'España' : 'Spain'].join(', ');
}

export type IdentityLine = { label: string; value: string; href?: string };

/** The seller's identity as label/value lines; empty fields are left out. */
export function identityLines(identity: SellerIdentity, locale: Locale): IdentityLine[] {
  const es = locale === 'es';
  const address = postalAddress(identity, locale);
  const lines: Array<IdentityLine | null> = [
    { label: es ? 'Titular' : 'Owner', value: identity.name },
    { label: es ? 'Nombre comercial' : 'Trading name', value: identity.brand },
    identity.taxId ? { label: 'NIF', value: identity.taxId } : null,
    address ? { label: es ? 'Domicilio' : 'Address', value: address } : null,
    { label: 'Email', value: identity.email, href: `mailto:${identity.email}` },
    {
      label: es ? 'Teléfono y WhatsApp' : 'Phone and WhatsApp',
      value: identity.phone,
      href: `tel:${identity.phone.replace(/\s+/g, '')}`,
    },
  ];
  return lines.filter((line): line is IdentityLine => line !== null);
}

/** Who a withdrawal notice goes to: name and brand, address, email. */
export function withdrawalAddressee(identity: SellerIdentity, locale: Locale): string {
  return [`${identity.name} (${identity.brand})`, postalAddress(identity, locale), identity.email]
    .filter(Boolean)
    .join(', ');
}
