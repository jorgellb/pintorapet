#!/usr/bin/env node
/**
 * Copy the media files listed by scripts/media-manifest.py to Cloudinary, under
 * the public id the site links to (mediaPublicId).
 *
 * Each file comes from its identical local copy when the manifest has one,
 * otherwise from Supabase Storage. Safe to run again: files already in
 * Cloudinary are skipped. Ends by checking which manifest files are in
 * Cloudinary; exits 1 if any is missing.
 *
 * Usage:
 *   python3 scripts/media-manifest.py /tmp/media.json
 *   node --env-file=.env scripts/copy-media-to-cloudinary.mjs /tmp/media.json --dry-run
 *   node --env-file=.env scripts/copy-media-to-cloudinary.mjs /tmp/media.json [--local-only]
 * Needs CLOUDINARY_URL; PUBLIC_SUPABASE_URL for files without a local copy.
 */
import { readFile } from 'node:fs/promises';
import {
  listImagePublicIds,
  mediaPublicId,
  parseCloudinaryUrl,
  uploadImage,
} from '../src/lib/server/media/cloudinary.ts';

const PARALLEL = 4;
const manifestPath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const localOnly = process.argv.includes('--local-only');

const cloudinary = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
const supabaseUrl = String(process.env.PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
if (!cloudinary || !manifestPath) {
  console.error('Usage: node --env-file=.env scripts/copy-media-to-cloudinary.mjs <manifest.json> [--dry-run] [--local-only]');
  process.exit(2);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8')).map((item) => ({
  ...item,
  publicId: mediaPublicId(item.bucket, item.objectPath),
}));
const ids = manifest.map((item) => item.publicId);
if (new Set(ids).size !== ids.length) {
  console.error('Two media files would share a Cloudinary id (same name, different extension). Stopping.');
  process.exit(1);
}

async function storedInCloudinary() {
  const present = new Set();
  for (const bucket of new Set(manifest.map((item) => item.bucket))) {
    for (const id of await listImagePublicIds(cloudinary, `${bucket}/`)) present.add(id);
  }
  return present;
}

async function bytesOf(item) {
  if (item.localPath) return new Uint8Array(await readFile(item.localPath));
  const path = item.objectPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/public/${item.bucket}/${path}`);
  if (!response.ok) throw new Error(`Supabase Storage answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const present = await storedInCloudinary();
const pending = manifest.filter((item) => !present.has(item.publicId) && (!localOnly || item.localPath));
console.log(
  `manifest: ${manifest.length} | already in Cloudinary: ${manifest.filter((i) => present.has(i.publicId)).length}` +
    ` | to copy now: ${pending.length} (${pending.filter((i) => i.localPath).length} from local copies)`,
);
if (dryRun) {
  for (const item of pending.slice(0, 5)) console.log(`  would copy ${item.localPath ?? 'Supabase'} -> ${item.publicId}`);
  process.exit(0);
}

const failures = [];
let copied = 0;
const queue = [...pending];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        await uploadImage(cloudinary, { bytes: await bytesOf(item), contentType: item.mimeType, publicId: item.publicId });
        copied += 1;
        if (copied % 25 === 0) console.log(`  copied ${copied}/${pending.length}`);
      } catch (err) {
        failures.push(`${item.bucket}/${item.objectPath}: ${err.message}`);
      }
    }
  }),
);
console.log(`copied: ${copied} | failed: ${failures.length}`);
for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`);

const after = await storedInCloudinary();
const missing = manifest.filter((item) => !after.has(item.publicId));
console.log(`check: ${manifest.length - missing.length}/${manifest.length} manifest files are in Cloudinary`);
process.exit(missing.length === 0 ? 0 : 1);
