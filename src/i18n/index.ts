import type { Locale } from './routes';
import { en, type Dictionary } from './en';
import { es } from './es';

const dictionaries: Record<Locale, Dictionary> = { en, es };

export function t(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export type { Dictionary, Locale };
