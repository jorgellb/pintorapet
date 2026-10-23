import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface SiteExtraAsset {
  id: string;
  label?: { en: string; es: string } | null;
  role?: string | null;
  sourceUrl?: string;
  status: string;
  publicUrl?: string | null;
  error?: string;
}

interface SiteExtrasDoc {
  groups: {
    about?: SiteExtraAsset[];
    commissionExamples?: SiteExtraAsset[];
    feedbacks?: SiteExtraAsset[];
    brand?: SiteExtraAsset[];
  };
}

let cache: SiteExtrasDoc | null = null;

async function loadDoc(): Promise<SiteExtrasDoc> {
  if (cache !== null) return cache;
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'migration', 'site-extras.json'),
      'utf8',
    );
    cache = JSON.parse(raw) as SiteExtrasDoc;
    return cache;
  } catch {
    cache = { groups: {} };
    return cache;
  }
}

function withUrl(items: SiteExtraAsset[] | undefined): SiteExtraAsset[] {
  return (items ?? []).filter((i) => Boolean(i.publicUrl));
}

export async function getAboutImages(): Promise<SiteExtraAsset[]> {
  return withUrl((await loadDoc()).groups.about);
}

export async function getFeedbackImages(): Promise<SiteExtraAsset[]> {
  return withUrl((await loadDoc()).groups.feedbacks);
}

export async function getCommissionExamples(): Promise<SiteExtraAsset[]> {
  return withUrl((await loadDoc()).groups.commissionExamples);
}

export async function getLogoUrl(): Promise<string | null> {
  const logo = (await loadDoc()).groups.brand?.find((b) => b.id === 'logo');
  return logo?.publicUrl ?? null;
}
