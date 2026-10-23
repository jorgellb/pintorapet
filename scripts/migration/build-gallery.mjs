#!/usr/bin/env node
/**
 * Build migration/gallery-extra.json from Anexo C.1 and download media.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const downloadDir = path.join(root, 'migration', 'downloads', 'gallery');
const publicDir = path.join(root, 'public', 'media', 'gallery');

const ITEMS = [
  {
    id: 'menu-1',
    title: { en: 'Menu', es: 'Menú' },
    group: 'illustration',
    assets: [
      {
        role: 'other',
        url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_4756-764x1080.jpg',
      },
    ],
  },
  {
    id: 'menu-2',
    title: { en: 'Menu', es: 'Menú' },
    group: 'illustration',
    assets: [
      {
        role: 'other',
        url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_4757-764x1080.jpg',
      },
    ],
  },
  {
    id: 'mojacar',
    title: { en: 'Mojácar', es: 'Mojácar' },
    group: 'architecture',
    assets: [
      {
        role: 'other',
        url: 'https://petsdrawings.com/wp-content/uploads/2025/03/IMG_6106.heic',
        note: 'HEIC original — prefer JPEG derivative if available later',
      },
    ],
  },
  {
    id: 'jungkook',
    title: { en: 'Jungkook', es: 'Jungkook' },
    group: 'people',
    assets: [
      {
        role: 'drawing',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Jungkook-singer-drawing-742x1080.jpeg',
        label: 'Jungkook singer drawing',
      },
      {
        role: 'reference_photo',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Jungkook-singer-photo-833x1080.jpg',
        label: 'Jungkook singer photo',
      },
    ],
  },
  {
    id: 'mothers-day',
    title: { en: "Mother's Day present", es: 'Regalo del Día de la Madre' },
    group: 'people',
    assets: [
      {
        role: 'reference_photo',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/05/Mother%C2%B4s-Day-Present-photo-736x1080.jpeg',
        label: "Mother's Day Present photo",
      },
      {
        role: 'drawing',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/05/Mother%C2%B4s-Day-present-drawing-805x1080.jpeg',
        label: "Mother's Day present drawing",
      },
    ],
  },
  {
    id: 'dylan-mia-jaedon',
    title: { en: 'Dylan, Mia, and Jaedon', es: 'Dylan, Mia y Jaedon' },
    group: 'people',
    assets: [
      {
        role: 'drawing',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/04/IMG_8876-749x1080.jpeg',
      },
      {
        role: 'reference_photo',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/04/IMG_3564.jpg',
      },
    ],
  },
  {
    id: 'mother-daughter',
    title: { en: 'Mother and daughter', es: 'Madre e hija' },
    group: 'people',
    assets: [
      {
        role: 'reference_photo',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Mother-and-photo.jpg',
        label: 'Mother and daughter photo',
      },
      {
        role: 'drawing',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Mother-and-daughter-drawing-791x1080.jpeg',
        label: 'Mother and daughter drawing',
      },
    ],
  },
  {
    id: 'valentine',
    title: { en: 'Gift Valentine', es: 'Regalo de San Valentín' },
    group: 'people',
    assets: [
      {
        role: 'drawing',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/04/IMG_3419-761x1080.jpeg',
      },
      {
        role: 'reference_photo',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/04/IMG_3188.jpg',
      },
    ],
  },
  {
    id: 'indian',
    title: { en: 'Indian', es: 'Indian' },
    group: 'people',
    assets: [
      {
        role: 'reference_photo',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Indian-photo-710x1080.jpeg',
      },
      {
        role: 'drawing',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/03/Indian-drawing-765x1080.jpeg',
      },
    ],
  },
  {
    id: 'book-drawing',
    title: { en: 'Drawing for book', es: 'Dibujo para libro' },
    group: 'illustration',
    assets: [
      {
        role: 'drawing',
        url: 'https://petsdrawings.com/wp-content/uploads/2023/03/drawing-for-book-762x1080.jpg',
      },
    ],
  },
];

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PetsDrawingsMigration/1.0 (+local rebuild)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return {
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

async function main() {
  await mkdir(downloadDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  const items = [];
  let errors = 0;

  for (let order = 0; order < ITEMS.length; order++) {
    const item = ITEMS[order];
    const assets = [];
    for (let i = 0; i < item.assets.length; i++) {
      const a = item.assets[i];
      let filename;
      try {
        filename = decodeURIComponent(path.basename(new URL(a.url).pathname));
      } catch {
        filename = `asset-${i}`;
      }
      const localRel = `migration/downloads/gallery/${item.id}-${i}-${filename}`;
      const localAbs = path.join(root, localRel);
      let meta = { status: 'pending' };
      let publicUrl;
      try {
        const d = await download(a.url, localAbs);
        const pubName = `${item.id}-${i}${path.extname(filename) || '.jpg'}`;
        const isHeic = /\.heic$/i.test(filename);
        if (!isHeic) {
          await copyFile(localAbs, path.join(publicDir, pubName));
          publicUrl = `/media/gallery/${pubName}`;
        }
        meta = {
          status: isHeic ? 'heic_pending_conversion' : 'ok',
          ...d,
          localPath: localRel,
          publicUrl: publicUrl ?? null,
        };
      } catch (err) {
        errors++;
        meta = { status: 'error', error: String(err?.message || err) };
      }
      assets.push({
        role: a.role,
        label: a.label ?? null,
        sourceUrl: a.url,
        note: a.note ?? null,
        ...meta,
      });
    }
    items.push({
      id: item.id,
      order: order + 1,
      group: item.group,
      title: item.title,
      assets,
    });
  }

  await writeFile(
    path.join(root, 'migration', 'gallery-extra.json'),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        source: 'PROMPT Anexo C.1',
        itemCount: items.length,
        downloadErrors: errors,
        items,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`gallery-extra.json: ${items.length} items, errors=${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
