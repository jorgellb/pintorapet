#!/usr/bin/env node
/**
 * Download Anexo C.2 (About), C.3 (commission examples), C.4 (feedbacks), C.5 logo.
 * Converts HEIC when needed. Writes migration/site-extras.json and public/media/*.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const downloadRoot = path.join(root, 'migration', 'downloads', 'site');
const publicRoot = path.join(root, 'public', 'media');

const EXTRAS = {
  about: [
    {
      id: 'about-1',
      url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_2523-1390x1080.jpg',
    },
    {
      id: 'about-2',
      url: 'https://petsdrawings.com/wp-content/uploads/2023/04/4-1565x1080.jpg',
    },
    {
      id: 'about-3',
      url: 'https://petsdrawings.com/wp-content/uploads/2023/04/1-1007x1080.jpg',
    },
    {
      id: 'about-4',
      url: 'https://petsdrawings.com/wp-content/uploads/2026/07/IMG_5205-rotated-810x1080.jpeg',
    },
  ],
  commissionExamples: [
    {
      id: 'kira-sox-drawing',
      label: { en: 'Kira & Sox', es: 'Kira y Sox' },
      role: 'drawing',
      url: 'https://petsdrawings.com/wp-content/uploads/2025/03/Kira-Sox.heic',
      // Prefer already-migrated portfolio JPEG if HEIC conversion fails:
      fallbackPublic:
        '/media/portfolio/sox-kira-sox-kira-0-Kira-Sox-1541x1080.jpeg',
    },
    {
      id: 'kira-sox-photo',
      label: { en: 'Kira & Sox photo', es: 'Foto Kira y Sox' },
      role: 'reference_photo',
      url: 'https://petsdrawings.com/wp-content/uploads/2025/03/photo-output-e1783718127926-1591x1080.png',
      fallbackPublic:
        '/media/portfolio/sox-kira-sox-kira-1-photo-output-e1783718127926-1591x1080.png',
    },
    {
      id: 'frankie-drawing',
      label: { en: 'Frankie drawing', es: 'Dibujo de Frankie' },
      role: 'drawing',
      url: 'https://petsdrawings.com/wp-content/uploads/2023/04/French-Bulldog-drawing-1551x1080.jpeg',
      fallbackPublic:
        '/media/portfolio/frankie-frankie-0-French-Bulldog-drawing-1551x1080.jpeg',
    },
    {
      id: 'frankie-photo',
      label: { en: 'Frankie photo', es: 'Foto de Frankie' },
      role: 'reference_photo',
      url: 'https://petsdrawings.com/wp-content/uploads/2023/04/French-Bulldog-photo-1438x1080.jpg',
      fallbackPublic: '/media/portfolio/frankie-frankie-1-French-Bulldog-photo-1438x1080.jpg',
    },
  ],
  feedbacks: [
    {
      id: 'feedback-1',
      url: 'https://petsdrawings.com/wp-content/uploads/2026/08/IMG_8507-598x1080.jpg',
    },
    {
      id: 'feedback-2',
      url: 'https://petsdrawings.com/wp-content/uploads/2026/08/IMG_8505-618x1080.jpg',
    },
    {
      id: 'feedback-3',
      url: 'https://petsdrawings.com/wp-content/uploads/2026/08/IMG_8504-656x1080.jpg',
    },
  ],
  brand: [
    {
      id: 'logo',
      url: 'https://petsdrawings.com/wp-content/uploads/2025/06/logo-pets-drawings.jpg',
    },
  ],
};

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

function convertHeic(src, destJpg) {
  const script = path.join(root, 'scripts', 'migration', 'convert-heic.py');
  const result = spawnSync('python3', [script, src, destJpg], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'heic convert failed');
  }
}

async function processItem(group, item) {
  await mkdir(path.join(downloadRoot, group), { recursive: true });
  await mkdir(path.join(publicRoot, group), { recursive: true });

  let filename;
  try {
    filename = decodeURIComponent(path.basename(new URL(item.url).pathname));
  } catch {
    filename = `${item.id}.bin`;
  }
  const localRel = `migration/downloads/site/${group}/${item.id}-${filename}`;
  const localAbs = path.join(root, localRel);
  const isHeic = /\.heic$/i.test(filename);

  try {
    const meta = await download(item.url, localAbs);
    let publicUrl;
    if (isHeic) {
      const jpgName = `${item.id}.jpg`;
      const jpgAbs = path.join(publicRoot, group, jpgName);
      convertHeic(localAbs, jpgAbs);
      publicUrl = `/media/${group}/${jpgName}`;
    } else {
      const ext = path.extname(filename) || '.jpg';
      const pubName = `${item.id}${ext}`;
      await copyFile(localAbs, path.join(publicRoot, group, pubName));
      publicUrl = `/media/${group}/${pubName}`;
    }
    return {
      id: item.id,
      label: item.label ?? null,
      role: item.role ?? null,
      sourceUrl: item.url,
      status: 'ok',
      localPath: localRel,
      publicUrl,
      ...meta,
    };
  } catch (err) {
    if (item.fallbackPublic && existsSync(path.join(root, 'public', item.fallbackPublic.replace(/^\//, '')))) {
      return {
        id: item.id,
        label: item.label ?? null,
        role: item.role ?? null,
        sourceUrl: item.url,
        status: 'fallback',
        publicUrl: item.fallbackPublic,
        error: String(err?.message || err),
      };
    }
    return {
      id: item.id,
      label: item.label ?? null,
      role: item.role ?? null,
      sourceUrl: item.url,
      status: 'error',
      error: String(err?.message || err),
      fallbackPublic: item.fallbackPublic ?? null,
    };
  }
}

async function main() {
  const out = {
    builtAt: new Date().toISOString(),
    source: 'PROMPT Anexo C.2–C.5',
    groups: {},
  };

  for (const [group, items] of Object.entries(EXTRAS)) {
    const results = [];
    for (const item of items) {
      const row = await processItem(group, item);
      results.push(row);
      console.log(group, row.id, row.status, row.publicUrl || row.error);
    }
    out.groups[group] = results;
  }

  await writeFile(
    path.join(root, 'migration', 'site-extras.json'),
    JSON.stringify(out, null, 2) + '\n',
  );
  console.log('wrote migration/site-extras.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
