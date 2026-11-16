import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMediaUrl, storagePublicUrl } from '../src/lib/server/storageUrl';

const SUPABASE = 'https://abc.supabase.co';
const CLOUD = 'https://res.cloudinary.com/demo-cloud/image/upload/c_limit,w_2000/f_auto/q_auto';

afterEach(() => vi.unstubAllEnvs());

describe('with Cloudinary configured', () => {
  function configure() {
    vi.stubEnv('PUBLIC_SUPABASE_URL', SUPABASE);
    vi.stubEnv('CLOUDINARY_URL', 'cloudinary://1234:shh@demo-cloud');
  }

  it('serves stored media from Cloudinary', () => {
    configure();
    expect(storagePublicUrl('catalog-public', 'catalog/1790.jpg')).toBe(`${CLOUD}/catalog-public/catalog/1790_jpg`);
  });

  it('maps local /media paths to Cloudinary', () => {
    configure();
    expect(resolveMediaUrl('/media/gallery/kira.jpg')).toBe(`${CLOUD}/portfolio-public/gallery/kira_jpg`);
    expect(resolveMediaUrl('/media/catalog/1790.jpg')).toBe(`${CLOUD}/catalog-public/catalog/1790_jpg`);
  });

  it('rewrites saved Supabase Storage links', () => {
    configure();
    const saved = `${SUPABASE}/storage/v1/object/public/portfolio-public/uploads/a%20b.png`;
    expect(resolveMediaUrl(saved)).toBe(`${CLOUD}/portfolio-public/uploads/a%20b_png`);
  });

  it('keeps other links and unknown local paths as they are', () => {
    configure();
    expect(resolveMediaUrl('https://example.com/x.jpg')).toBe('https://example.com/x.jpg');
    expect(resolveMediaUrl('/images/hero.jpg')).toBe('/images/hero.jpg');
    expect(resolveMediaUrl('')).toBe('');
    expect(resolveMediaUrl(null)).toBe('');
  });
});

describe('without Cloudinary', () => {
  it('keeps serving from Supabase Storage', () => {
    vi.stubEnv('PUBLIC_SUPABASE_URL', SUPABASE);
    vi.stubEnv('CLOUDINARY_URL', '');
    expect(storagePublicUrl('catalog-public', 'catalog/1790.jpg')).toBe(
      `${SUPABASE}/storage/v1/object/public/catalog-public/catalog/1790.jpg`,
    );
    expect(resolveMediaUrl('/media/catalog/1790.jpg')).toBe(
      `${SUPABASE}/storage/v1/object/public/catalog-public/catalog/1790.jpg`,
    );
    const saved = `${SUPABASE}/storage/v1/object/public/portfolio-public/x.png`;
    expect(resolveMediaUrl(saved)).toBe(saved);
  });

  it('leaves local paths alone when no storage is configured', () => {
    vi.stubEnv('PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('CLOUDINARY_URL', '');
    expect(resolveMediaUrl('/media/catalog/1790.jpg')).toBe('/media/catalog/1790.jpg');
  });
});
