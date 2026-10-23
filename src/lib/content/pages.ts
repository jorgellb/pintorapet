import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locale } from '@/i18n/routes';

export type PageKey = 'about' | 'contact' | 'commissions' | 'gallery' | 'work';

interface PageLocale {
  sourceUrl: string;
  documentTitle?: string | null;
  h1?: string | null;
  paragraphs?: string[];
  text: string;
  charCount: number;
}

interface PagesDoc {
  pages: Partial<Record<PageKey, Partial<Record<Locale, PageLocale>>>>;
}

let cache: PagesDoc | null = null;

async function loadPagesDoc(): Promise<PagesDoc> {
  if (cache) return cache;
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'migration', 'pages.json'),
      'utf8',
    );
    cache = JSON.parse(raw) as PagesDoc;
    return cache;
  } catch {
    cache = { pages: {} };
    return cache;
  }
}

export async function getPageCopy(
  key: PageKey,
  locale: Locale,
): Promise<{ title: string | null; paragraphs: string[] }> {
  const doc = await loadPagesDoc();
  const entry = doc.pages[key]?.[locale];
  if (!entry) return { title: null, paragraphs: [] };
  const paragraphs =
    entry.paragraphs?.filter((p) => p.trim().length > 0) ??
    entry.text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 20);
  return {
    title: entry.h1 ?? null,
    paragraphs,
  };
}
