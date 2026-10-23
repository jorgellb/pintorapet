#!/usr/bin/env node
/**
 * Build migration/artworks.json from Anexo B/C of the prompt (stable IDs + source URLs).
 * Downloads portfolio media into migration/downloads/portfolio/ when network allows.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const downloadDir = path.join(root, 'migration', 'downloads', 'portfolio');

/** Prompt Anexo B — order preserved; roles inferred from labels where possible. */
const WORK_GROUPS = [
  {
    id: 'dogs-a3-1',
    title: { en: 'Dogs A3', es: 'Perros A3' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1612-1547x1080.jpg' },
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/08/A3-drawing-jack-russels-1528x1080.jpg' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2026/08/IMG_5270.jpg' },
    ],
  },
  {
    id: 'dogs-a3-2',
    title: { en: 'Dogs A3', es: 'Perros A3' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1585-1528x1080.jpg' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2026/08/BE046129-13D3-42A6-87A1-F3C54DF4DE2B-1620x1080.jpg' },
    ],
  },
  {
    id: 'mabel',
    title: { en: 'Mabel', es: 'Mabel' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1562-e1786611102186-764x1080.jpg', label: 'Mabel' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1955-810x1080.jpg', label: 'Mabel' },
    ],
  },
  {
    id: 'dog-generic-1',
    title: { en: 'Dog', es: 'Perro' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1509-770x1080.jpg' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2026/08/PHOTO-2025-06-07-10-21-49-e1786446260284.jpg' },
    ],
  },
  {
    id: 'smokey',
    title: { en: 'Smokey', es: 'Smokey' },
    category: 'cat',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_3394-pdf-755x1080.jpg', label: 'Smokey' },
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_3427-pdf-810x1080.jpg', label: 'Smocky' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/1000056511.jpg', label: 'Smoky' },
    ],
  },
  {
    id: 'dog-generic-2',
    title: { en: 'Dog', es: 'Perro' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_1234-770x1080.jpg' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/20250616_160803-810x1080.jpg' },
    ],
  },
  {
    id: 'michi-pantera',
    title: { en: 'Michi & Pantera', es: 'Michi y Pantera' },
    category: 'cat',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_2576-2-2-pdf-765x1080.jpg', label: 'Michi' },
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_2491-2-pdf-770x1080.jpg', label: 'Pantera' },
      { role: 'related_product_photo', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_2580-1-pdf-1055x1080.jpg', label: 'Mugs & Coasters' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/29a4b4ee-656f-4bd6-a422-33a2b33419b9-919x1080.jpg', label: 'Michi' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2026/07/d110a758-343a-4e15-830b-8622ecfc4897.jpg', label: 'Pantera' },
    ],
  },
  {
    id: 'rufus',
    title: { en: 'Rufus', es: 'Rufus' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2025/03/Rufus-762x1080.jpeg', label: 'Rufus' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2025/03/9ad5b5d1-3593-41f0-84a1-2d622237b608-801x1080.jpg', label: 'Rufus' },
    ],
  },
  {
    id: 'sox-kira',
    title: { en: 'Sox & Kira', es: 'Sox y Kira' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2025/03/Kira-Sox-1541x1080.jpeg', label: 'Kira & Sox' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2025/03/photo-output-e1783718127926-1591x1080.png', label: 'Kira & Sox' },
    ],
  },
  {
    id: 'chester',
    title: { en: 'Chester', es: 'Chester' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2025/03/IMG_9321-copy-852x1080.jpg', label: 'Chester' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2025/03/IMG_1590-865x1080.jpg', label: 'Chester' },
    ],
  },
  {
    id: 'moquitos',
    title: { en: 'Moquitos', es: 'Moquitos' },
    category: 'horse',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2025/03/Moquitos-788x1080.jpeg', label: 'Moquitos' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2025/03/MOquitos-1-871x1080.jpg', label: 'Moquitos' },
    ],
  },
  {
    id: 'millie-cat',
    title: { en: 'Millie', es: 'Millie' },
    category: 'cat',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/05/Millie-Drawing-873x1080.jpeg', label: 'Millie Drawing' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/05/Millie-Photo.jpg', label: 'Millie Photo' },
    ],
  },
  {
    id: 'tida',
    title: { en: 'Tida', es: 'Tida' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/03/Tida-dog-drawing-rotated-810x1080.jpeg', label: 'Tida drawing' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Tida-dog-photo-691x1080.jpg', label: 'Tida photo' },
    ],
  },
  {
    id: 'frankie',
    title: { en: 'Frankie', es: 'Frankie' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/French-Bulldog-drawing-1551x1080.jpeg', label: 'Frankie drawing' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/French-Bulldog-photo-1438x1080.jpg', label: 'Frankie photo' },
    ],
  },
  {
    id: 'doggy',
    title: { en: 'Doggy', es: 'Doggy' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/03/Doggy-my-dog-drawing-1535x1080.jpg', label: 'Doggy drawing' },
      { role: 'comparison', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Doggy-my-dog-comparing-1440x1080.jpeg', label: 'Doggy comparing' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Doggy-my-dog-photo-1620x1080.jpeg', label: 'Doggy photo' },
    ],
  },
  {
    id: 'patron',
    title: { en: 'Patrón', es: 'Patrón' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Dog-Pedro-Arg-drawing-760x1080.jpg', label: 'Patron drawing' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Dog-Pedro-Arg-photo-608x1080.jpg', label: 'Patron photo' },
    ],
  },
  {
    id: 'lucky-estrella',
    title: { en: 'Lucky and Estrella', es: 'Lucky y Estrella' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Lucky-and-Estrella-dogs-drawing-1-758x1080.jpg' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/05/Lucky-and-Estrella-dogs-photo-792x1080.jpg' },
    ],
  },
  {
    id: 'nara',
    title: { en: 'Nara', es: 'Nara' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Dubi-dog-Nara-drawing-755x1080.jpg', label: 'Nara drawing' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Dubi-dog-Nara-photo.jpg', label: 'Nara photo' },
    ],
  },
  {
    id: 'millie-lady-charlie',
    title: { en: 'Millie, Lady and Charlie', es: 'Millie, Lady y Charlie' },
    category: 'dog',
    assets: [
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Millie-dog-drawing-1560x1080.jpg', label: 'Millie drawing' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Millie-dog-photo.jpg', label: 'Millie photo' },
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/03/Charlie-dog-drawing-1539x1080.jpg', label: 'Charlie drawing' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Lady-dog-photo.jpeg', label: 'Lady photo' },
      { role: 'drawing', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Lady-dog-drawing.jpeg', label: 'Lady drawing' },
      { role: 'reference_photo', url: 'https://petsdrawings.com/wp-content/uploads/2023/04/Charlie-dog-photo-1374x1080.jpg', label: 'Charlie photo' },
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
  const skipDownload = process.argv.includes('--manifest-only');
  await mkdir(downloadDir, { recursive: true });
  const artworks = [];
  let downloadErrors = 0;

  for (let order = 0; order < WORK_GROUPS.length; order++) {
    const group = WORK_GROUPS[order];
    const assets = [];
    for (let i = 0; i < group.assets.length; i++) {
      const a = group.assets[i];
      const filename = path.basename(new URL(a.url).pathname);
      const localRel = `migration/downloads/portfolio/${group.id}-${i}-${filename}`;
      const localAbs = path.join(root, localRel);
      let meta = { status: 'pending' };
      if (!skipDownload) {
        try {
          const d = await download(a.url, localAbs);
          meta = { status: 'ok', ...d, localPath: localRel };
        } catch (err) {
          downloadErrors++;
          meta = { status: 'error', error: String(err?.message || err) };
        }
      }
      assets.push({
        role: a.role,
        label: a.label ?? null,
        sourceUrl: a.url,
        ...meta,
      });
    }
    artworks.push({
      id: group.id,
      order: order + 1,
      category: group.category,
      title: group.title,
      pathSlugs: { en: group.id, es: group.id },
      assets,
    });
  }

  const out = {
    builtAt: new Date().toISOString(),
    source: 'PROMPT Anexo B',
    artworkCount: artworks.length,
    downloadErrors,
    artworks,
  };
  await writeFile(
    path.join(root, 'migration', 'artworks.json'),
    JSON.stringify(out, null, 2) + '\n',
  );
  console.log(
    `artworks.json: ${artworks.length} groups, downloadErrors=${downloadErrors}${skipDownload ? ' (manifest-only)' : ''}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
