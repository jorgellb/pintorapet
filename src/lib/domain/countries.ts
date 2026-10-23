/** Destinations the shop can ship to (ISO 3166-1 alpha-2, accepted by Stripe Checkout). */
export const SHIPPING_COUNTRIES = [
  'ES', 'PT', 'FR', 'DE', 'IT', 'NL', 'BE', 'LU', 'IE', 'AT', 'DK', 'SE', 'FI', 'PL', 'CZ', 'SK',
  'HU', 'SI', 'HR', 'RO', 'BG', 'GR', 'CY', 'MT', 'EE', 'LV', 'LT', 'GB', 'CH', 'NO', 'IS', 'AD',
  'MC', 'SM', 'LI', 'VA', 'GI', 'RS', 'BA', 'ME', 'MK', 'AL', 'MD', 'UA', 'US', 'CA', 'MX', 'AR',
  'BR', 'CL', 'CO', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'GT', 'HN', 'SV', 'NI', 'DO',
  'PR', 'AU', 'NZ', 'JP', 'KR', 'CN', 'HK', 'TW', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID', 'IN', 'IL',
  'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'JO', 'TR', 'MA', 'TN', 'EG', 'ZA', 'KE', 'NG', 'GH', 'SN',
] as const;

export type ShippingCountry = (typeof SHIPPING_COUNTRIES)[number];

export function isShippingCountry(code: string): code is ShippingCountry {
  return (SHIPPING_COUNTRIES as readonly string[]).includes(code.toUpperCase());
}

/** Countries sorted by their localised name, with Spain first. */
export function countryOptions(locale: 'en' | 'es'): Array<{ code: string; name: string }> {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const rest = SHIPPING_COUNTRIES.filter((c) => c !== 'ES')
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  return [{ code: 'ES', name: names.of('ES') ?? 'España' }, ...rest];
}

const ISO3: Record<string, string> = {
  ES: 'ESP', PT: 'PRT', FR: 'FRA', DE: 'DEU', IT: 'ITA', NL: 'NLD', BE: 'BEL', LU: 'LUX', IE: 'IRL',
  AT: 'AUT', DK: 'DNK', SE: 'SWE', FI: 'FIN', PL: 'POL', CZ: 'CZE', SK: 'SVK', HU: 'HUN', SI: 'SVN',
  HR: 'HRV', RO: 'ROU', BG: 'BGR', GR: 'GRC', CY: 'CYP', MT: 'MLT', EE: 'EST', LV: 'LVA', LT: 'LTU',
  GB: 'GBR', CH: 'CHE', NO: 'NOR', IS: 'ISL', AD: 'AND', MC: 'MCO', SM: 'SMR', LI: 'LIE', VA: 'VAT',
  GI: 'GIB', RS: 'SRB', BA: 'BIH', ME: 'MNE', MK: 'MKD', AL: 'ALB', MD: 'MDA', UA: 'UKR', US: 'USA',
  CA: 'CAN', MX: 'MEX', AR: 'ARG', BR: 'BRA', CL: 'CHL', CO: 'COL', PE: 'PER', UY: 'URY', PY: 'PRY',
  BO: 'BOL', EC: 'ECU', VE: 'VEN', CR: 'CRI', PA: 'PAN', GT: 'GTM', HN: 'HND', SV: 'SLV', NI: 'NIC',
  DO: 'DOM', PR: 'PRI', AU: 'AUS', NZ: 'NZL', JP: 'JPN', KR: 'KOR', CN: 'CHN', HK: 'HKG', TW: 'TWN',
  SG: 'SGP', MY: 'MYS', TH: 'THA', VN: 'VNM', PH: 'PHL', ID: 'IDN', IN: 'IND', IL: 'ISR', AE: 'ARE',
  SA: 'SAU', QA: 'QAT', KW: 'KWT', BH: 'BHR', OM: 'OMN', JO: 'JOR', TR: 'TUR', MA: 'MAR', TN: 'TUN',
  EG: 'EGY', ZA: 'ZAF', KE: 'KEN', NG: 'NGA', GH: 'GHA', SN: 'SEN',
};

export function iso3(code: string): string | null {
  return ISO3[code.toUpperCase()] ?? null;
}
