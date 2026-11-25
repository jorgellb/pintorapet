import type { Locale } from '@/i18n';

/**
 * What is known of each type of piece, for the "Detalles" list on its page.
 * Only facts confirmed by Meili (capacity, materials, what comes with it):
 * a type that is not here shows no list rather than a guess.
 */
type Detail = { label: string; value: string };

const DETAILS: Record<string, Record<Locale, Detail[]>> = {
  mugs: {
    es: [
      { label: 'Material', value: 'Cerámica blanca' },
      { label: 'Capacidad', value: '325 ml (11 oz)' },
      { label: 'Medidas', value: '8,3 cm de diámetro × 9,7 cm de alto' },
      { label: 'Cuidado', value: 'Apta para lavavajillas y microondas' },
    ],
    en: [
      { label: 'Material', value: 'White ceramic' },
      { label: 'Capacity', value: '325 ml (11 oz)' },
      { label: 'Size', value: '8.3 cm across × 9.7 cm high' },
      { label: 'Care', value: 'Dishwasher and microwave safe' },
    ],
  },
  coasters: {
    es: [
      { label: 'Contenido', value: '4 posavasos con el mismo retrato' },
      { label: 'Material', value: 'Tablero con base de corcho' },
      { label: 'Acabado', value: 'Esquinas redondeadas' },
    ],
    en: [
      { label: 'In the set', value: '4 coasters with the same portrait' },
      { label: 'Material', value: 'Hardboard with a cork back' },
      { label: 'Finish', value: 'Rounded corners' },
    ],
  },
  'greeting-cards': {
    es: [{ label: 'Incluye', value: 'Sobre transparente' }],
    en: [{ label: 'Comes with', value: 'A clear envelope' }],
  },
  keyrings: {
    es: [
      { label: 'Formas', value: 'Redondo o rectangular' },
      { label: 'Herrajes', value: 'Anilla y cadena metálicas' },
    ],
    en: [
      { label: 'Shapes', value: 'Round or rectangular' },
      { label: 'Fittings', value: 'Metal ring and chain' },
    ],
  },
  ornaments: {
    es: [
      { label: 'Bola', value: 'Transparente, con el retrato dentro' },
      { label: 'Incluye', value: 'Lazo de terciopelo rojo y cordel para colgar' },
    ],
    en: [
      { label: 'Bauble', value: 'Clear, with the portrait inside' },
      { label: 'Comes with', value: 'Red velvet bow and a string to hang it' },
    ],
  },
};

export function productDetails(type: string, locale: Locale): Detail[] {
  return DETAILS[type]?.[locale] ?? [];
}
