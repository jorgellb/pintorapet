import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteMedia, uploadMedia } from '../src/lib/server/admin/editorial';
import { CommerceError } from '../src/lib/server/commerce/errors';
import { CloudinaryError } from '../src/lib/server/media/cloudinary';
import type { MediaStore } from '../src/lib/server/media/store';
import { fakeDb } from './helpers/fakeDb';

const MEDIA_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => vi.stubEnv('CLOUDINARY_URL', 'cloudinary://1234:shh@demo-cloud'));
afterEach(() => vi.unstubAllEnvs());

function fakeStore(overrides: Partial<MediaStore> = {}): MediaStore {
  return { put: vi.fn(async () => {}), remove: vi.fn(async () => {}), ...overrides };
}

/** media_assets insert/select/delete and the alt-text upsert, answered as PostgreSQL would. */
function fakeClient(opts: { insertError?: string; existing?: Record<string, unknown> | null } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const { db } = fakeDb({
    query: (q) => {
      if (q.text.includes('insert into public.media_assets')) {
        if (opts.insertError) throw new Error(opts.insertError);
        const [origin, bucket, object_path, mime_type, byte_size, processing_status] = q.values;
        const row = { origin, bucket, object_path, mime_type, byte_size, processing_status };
        inserted.push(row);
        return { id: MEDIA_ID, created_at: '2026-11-16T12:00:00Z', ...row };
      }
      if (q.text.includes('select bucket, object_path from public.media_assets')) return opts.existing ?? null;
      if (q.text.includes('delete from public.media_assets')) {
        deleted.push(String(q.values[0]));
        return 1;
      }
      return undefined;
    },
  });
  return { client: db, inserted, deleted };
}

function image(name: string, bytes = 3, type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('uploadMedia', () => {
  it('stores the image in Cloudinary and records where it is', async () => {
    const store = fakeStore();
    const { client, inserted } = fakeClient();

    const row = await uploadMedia(client, image('Luna Foto.PNG'), 'portfolio-public', 'Luna', 'Luna', store);

    const objectPath = String(inserted[0]?.object_path);
    expect(objectPath).toMatch(/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}-luna-foto\.png$/);
    expect(inserted[0]).toMatchObject({ bucket: 'portfolio-public', mime_type: 'image/png', byte_size: 3 });
    expect(store.put).toHaveBeenCalledWith(
      `portfolio-public/${objectPath.replace(/\.png$/, '_png')}`,
      expect.any(Uint8Array),
      'image/png',
    );
    expect(row.publicUrl).toBe(
      `https://res.cloudinary.com/demo-cloud/image/upload/c_limit,w_2000/f_auto/q_auto/portfolio-public/${objectPath.replace(/\.png$/, '_png')}`,
    );
  });

  it('removes the stored image when the database refuses the record', async () => {
    const store = fakeStore();
    const { client } = fakeClient({ insertError: 'boom' });

    await expect(uploadMedia(client, image('a.png'), 'catalog-public', '', '', store)).rejects.toBeInstanceOf(
      CommerceError,
    );
    const [publicId] = (store.put as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(store.remove).toHaveBeenCalledWith(publicId);
  });

  it('refuses images over the 10 MB Cloudinary limit before uploading', async () => {
    const store = fakeStore();
    const { client } = fakeClient();
    const big = image('big.jpg', 10 * 1024 * 1024 + 1, 'image/jpeg');

    await expect(uploadMedia(client, big, 'catalog-public', '', '', store)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'Image is larger than 10 MB',
    });
    expect(store.put).not.toHaveBeenCalled();
  });

  it('shows why Cloudinary rejected an image', async () => {
    const store = fakeStore({
      put: vi.fn(async () => {
        throw new CloudinaryError('Resource has too many megapixels', 400);
      }),
    });
    const { client, inserted } = fakeClient();

    await expect(uploadMedia(client, image('a.jpg', 3, 'image/jpeg'), 'catalog-public', '', '', store)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'Cloudinary: Resource has too many megapixels',
    });
    expect(inserted).toHaveLength(0);
  });
});

describe('deleteMedia', () => {
  it('deletes the Cloudinary image and then the record', async () => {
    const store = fakeStore();
    const { client, deleted } = fakeClient({ existing: { bucket: 'catalog-public', object_path: 'catalog/1790.jpg' } });

    await deleteMedia(client, MEDIA_ID, store);

    expect(store.remove).toHaveBeenCalledWith('catalog-public/catalog/1790_jpg');
    expect(deleted).toEqual([MEDIA_ID]);
  });

  it('answers 404 for unknown media without touching Cloudinary', async () => {
    const store = fakeStore();
    const { client } = fakeClient({ existing: null });

    await expect(deleteMedia(client, MEDIA_ID, store)).rejects.toMatchObject({ status: 404 });
    expect(store.remove).not.toHaveBeenCalled();
  });
});
