#!/usr/bin/env node
/**
 * Upload local public/media files into Supabase Storage and upsert media_assets rows.
 *
 * Requires migrations (incl. storage buckets) + service role.
 *
 * Usage:
 *   export PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   node scripts/upload-storage.mjs
 *   node scripts/upload-storage.mjs --dry-run
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

const GROUPS = [
  {
    dir: path.join(root, 'public/media/catalog'),
    bucket: 'catalog-public',
    prefix: 'catalog',
  },
  {
    dir: path.join(root, 'public/media/portfolio'),
    bucket: 'portfolio-public',
    prefix: 'portfolio',
  },
  {
    dir: path.join(root, 'public/media/gallery'),
    bucket: 'portfolio-public',
    prefix: 'gallery',
  },
  {
    dir: path.join(root, 'public/media/about'),
    bucket: 'portfolio-public',
    prefix: 'about',
  },
  {
    dir: path.join(root, 'public/media/feedbacks'),
    bucket: 'portfolio-public',
    prefix: 'feedbacks',
  },
  {
    dir: path.join(root, 'public/media/commissionExamples'),
    bucket: 'portfolio-public',
    prefix: 'commission-examples',
  },
  {
    dir: path.join(root, 'public/media/brand'),
    bucket: 'portfolio-public',
    prefix: 'brand',
  },
];

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function listFiles(dir) {
  try {
    const names = await readdir(dir);
    const out = [];
    for (const name of names) {
      const abs = path.join(dir, name);
      const st = await stat(abs);
      if (st.isFile()) out.push(abs);
    }
    return out;
  } catch {
    return [];
  }
}

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Need PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let uploaded = 0;
let skipped = 0;
let errors = 0;

for (const group of GROUPS) {
  const files = await listFiles(group.dir);
  for (const abs of files) {
    const base = path.basename(abs);
    const ext = path.extname(base).toLowerCase();
    const mime = MIME[ext];
    if (!mime) {
      console.warn('skip unsupported', abs);
      skipped += 1;
      continue;
    }
    const buf = await readFile(abs);
    const sha = createHash('sha256').update(buf).digest('hex');
    const objectPath = `${group.prefix}/${base}`;

    console.log(dryRun ? 'dry-run' : 'upload', group.bucket, objectPath, buf.length);

    if (dryRun) {
      uploaded += 1;
      continue;
    }

    const { error: upErr } = await supabase.storage
      .from(group.bucket)
      .upload(objectPath, buf, {
        contentType: mime,
        upsert: true,
      });
    if (upErr) {
      console.error('upload failed', objectPath, upErr.message);
      errors += 1;
      continue;
    }

    const { error: rowErr } = await supabase.from('media_assets').upsert(
      {
        origin: 'migration',
        bucket: group.bucket,
        object_path: objectPath,
        mime_type: mime,
        byte_size: buf.length,
        content_hash: sha,
        processing_status: 'ready',
      },
      { onConflict: 'bucket,object_path' },
    );
    if (rowErr) {
      console.error('media_assets upsert failed', objectPath, rowErr.message);
      errors += 1;
      continue;
    }
    uploaded += 1;
  }
}

console.log(JSON.stringify({ dryRun, uploaded, skipped, errors }, null, 2));
if (errors) process.exit(1);
