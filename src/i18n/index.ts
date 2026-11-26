import type { Locale } from './routes';
import { en, type Dictionary } from './en';
import { es } from './es';

const dictionaries: Record<Locale, Dictionary> = { en, es };

export function t(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export type { Dictionary, Locale };

/** Fills the `{name}` holes of a dictionary text. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (hole, key: string) => (key in values ? String(values[key]) : hole));
}
