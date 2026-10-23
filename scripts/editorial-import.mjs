#!/usr/bin/env node
/**
 * Copy the current artwork and extra-gallery JSON into Supabase.
 *
 *   export PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   node scripts/editorial-import.mjs
 *
 * Safe to run again: rows match on legacy_id and their images are replaced.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Need PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function readDir(dir) {
  const names = await readdir(dir);
  const rows = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    rows.push(JSON.parse(await readFile(path.join(dir, name), 'utf8')));
  }
  return rows;
}

async function importWorks() {
  const works = await readDir(path.join('src', 'content', 'work'));
  for (const work of works) {
    const saved = await supabase
      .from('artworks')
      .upsert(
        {
          legacy_id: work.id,
          slug_en: work.pathSlugs.en,
          slug_es: work.pathSlugs.es,
          category: work.category,
          title_en: work.title.en,
          title_es: work.title.es,
          summary_en: work.summary?.en ?? '',
          summary_es: work.summary?.es ?? '',
          story_en: work.story?.en ?? '',
          story_es: work.story?.es ?? '',
          sort_order: work.order ?? 0,
          published: true,
        },
        { onConflict: 'legacy_id' },
      )
      .select('id')
      .single();
    if (saved.error || !saved.data) {
      throw new Error(`${work.id}: ${saved.error?.message ?? 'no id'}`);
    }
    const removed = await supabase.from('artwork_assets').delete().eq('artwork_id', saved.data.id);
    if (removed.error) throw new Error(removed.error.message);
    const assets = (work.assets ?? [])
      .filter((asset) => asset.src)
      .map((asset, index) => ({
        artwork_id: saved.data.id,
        role: asset.role,
        src: asset.src,
        label: asset.label ?? null,
        alt_en: asset.alt?.en ?? '',
        alt_es: asset.alt?.es ?? '',
        sort_order: index,
      }));
    if (assets.length) {
      const inserted = await supabase.from('artwork_assets').insert(assets);
      if (inserted.error) throw new Error(`${work.id}: ${inserted.error.message}`);
    }
    console.log(`work ${work.id}`);
  }
}

async function importGallery() {
  const items = await readDir(path.join('src', 'content', 'gallery'));
  for (const item of items) {
    const saved = await supabase
      .from('gallery_items')
      .upsert(
        {
          legacy_id: item.id,
          item_group: item.group,
          title_en: item.title.en,
          title_es: item.title.es,
          summary_en: item.summary?.en ?? '',
          summary_es: item.summary?.es ?? '',
          story_en: item.story?.en ?? '',
          story_es: item.story?.es ?? '',
          sort_order: item.order ?? 0,
          published: true,
        },
        { onConflict: 'legacy_id' },
      )
      .select('id')
      .single();
    if (saved.error || !saved.data) {
      throw new Error(`${item.id}: ${saved.error?.message ?? 'no id'}`);
    }
    const removed = await supabase.from('gallery_assets').delete().eq('gallery_item_id', saved.data.id);
    if (removed.error) throw new Error(removed.error.message);
    const assets = (item.assets ?? [])
      .filter((asset) => asset.src)
      .map((asset, index) => ({
        gallery_item_id: saved.data.id,
        role: asset.role,
        src: asset.src,
        alt_en: asset.alt?.en ?? '',
        alt_es: asset.alt?.es ?? '',
        sort_order: index,
      }));
    if (assets.length) {
      const inserted = await supabase.from('gallery_assets').insert(assets);
      if (inserted.error) throw new Error(`${item.id}: ${inserted.error.message}`);
    }
    console.log(`gallery ${item.id}`);
  }
}

await importWorks();
await importGallery();
console.log('Editorial import finished.');
