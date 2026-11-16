import { describe, expect, it, vi } from 'vitest';
import {
  CloudinaryError,
  cloudinaryImageUrl,
  destroyImage,
  jpegDeliveryUrl,
  listImagePublicIds,
  mediaPublicId,
  parseCloudinaryUrl,
  signCloudinaryParams,
  uploadImage,
} from '../src/lib/server/media/cloudinary';

const config = { cloudName: 'demo-cloud', apiKey: '1234', apiSecret: 'shh' };
const fixedNow = () => 1_700_000_000_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('parseCloudinaryUrl', () => {
  it('reads cloud name, key and secret', () => {
    expect(parseCloudinaryUrl('cloudinary://1234:shh@demo-cloud')).toEqual(config);
  });

  it('rejects missing or malformed values', () => {
    expect(parseCloudinaryUrl(undefined)).toBeNull();
    expect(parseCloudinaryUrl('')).toBeNull();
    expect(parseCloudinaryUrl('https://1234:shh@demo-cloud')).toBeNull();
    expect(parseCloudinaryUrl('cloudinary://1234@demo-cloud')).toBeNull();
  });
});

describe('mediaPublicId', () => {
  it('joins bucket and path, with the extension kept as a suffix', () => {
    expect(mediaPublicId('catalog-public', 'catalog/1790.jpg')).toBe('catalog-public/catalog/1790_jpg');
    expect(mediaPublicId('portfolio-public', '/portfolio/rufus-0-Rufus-762x1080.jpeg')).toBe(
      'portfolio-public/portfolio/rufus-0-Rufus-762x1080_jpeg',
    );
  });

  it('keeps logo.jpg and logo.png apart', () => {
    expect(mediaPublicId('portfolio-public', 'brand/logo.jpg')).not.toBe(mediaPublicId('portfolio-public', 'brand/logo.png'));
  });

  it('keeps other dots', () => {
    expect(mediaPublicId('catalog-public', '2026-11-16/abc-luna.v2.png')).toBe('catalog-public/2026-11-16/abc-luna.v2_png');
  });
});

describe('cloudinaryImageUrl', () => {
  it('serves an optimised, size-capped image in the best format for the browser', () => {
    expect(cloudinaryImageUrl('demo-cloud', 'catalog-public/catalog/1790')).toBe(
      'https://res.cloudinary.com/demo-cloud/image/upload/c_limit,w_2000/f_auto/q_auto/catalog-public/catalog/1790',
    );
  });

  it('can force JPEG', () => {
    expect(cloudinaryImageUrl('demo-cloud', 'a/b', 'jpg')).toBe(
      'https://res.cloudinary.com/demo-cloud/image/upload/c_limit,w_2000/f_jpg/q_auto/a/b',
    );
  });

  it('encodes each path segment', () => {
    expect(cloudinaryImageUrl('demo-cloud', 'a/b c')).toMatch(/\/a\/b%20c$/);
  });
});

describe('jpegDeliveryUrl', () => {
  it('turns an automatic-format Cloudinary URL into a JPEG one', () => {
    const auto = cloudinaryImageUrl('demo-cloud', 'a/b');
    expect(jpegDeliveryUrl(auto)).toBe(cloudinaryImageUrl('demo-cloud', 'a/b', 'jpg'));
  });

  it('leaves other URLs alone', () => {
    const other = 'https://example.supabase.co/storage/v1/object/public/catalog-public/catalog/1790.jpg';
    expect(jpegDeliveryUrl(other)).toBe(other);
  });
});

describe('signCloudinaryParams', () => {
  it('matches the example in the Cloudinary documentation', () => {
    const params = { timestamp: 1315060510, public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' };
    expect(signCloudinaryParams(params, 'abcd')).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });
});

describe('uploadImage', () => {
  it('sends a signed upload that never overwrites', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ public_id: 'catalog-public/x', bytes: 3 }));
    const result = await uploadImage(
      config,
      { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png', publicId: 'catalog-public/x' },
      { fetchImpl, now: fixedNow },
    );

    expect(result).toEqual({ publicId: 'catalog-public/x', bytes: 3 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('api_key')).toBe('1234');
    expect(form.get('public_id')).toBe('catalog-public/x');
    expect(form.get('overwrite')).toBe('false');
    expect(form.get('timestamp')).toBe('1700000000');
    expect(form.get('signature')).toBe(
      signCloudinaryParams({ overwrite: 'false', public_id: 'catalog-public/x', timestamp: 1700000000 }, 'shh'),
    );
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(form.has('api_secret')).toBe(false);
  });

  it('reports the Cloudinary error message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'File size too large' } }, 400));
    await expect(
      uploadImage(config, { bytes: new Uint8Array([1]), contentType: 'image/png', publicId: 'a/b' }, { fetchImpl }),
    ).rejects.toMatchObject({ name: 'CloudinaryError', status: 400, message: 'File size too large' });
  });
});

describe('destroyImage', () => {
  it('sends a signed delete that also clears the CDN cache', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: 'ok' }));
    await expect(destroyImage(config, 'a/b', { fetchImpl, now: fixedNow })).resolves.toBe('ok');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/destroy');
    const form = init.body as FormData;
    expect(form.get('invalidate')).toBe('true');
    expect(form.get('signature')).toBe(
      signCloudinaryParams({ invalidate: 'true', public_id: 'a/b', timestamp: 1700000000 }, 'shh'),
    );
  });

  it('treats an image that is already gone as deleted', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: 'not found' }));
    await expect(destroyImage(config, 'a/b', { fetchImpl })).resolves.toBe('not found');
  });

  it('fails on anything else', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: 'error' }));
    await expect(destroyImage(config, 'a/b', { fetchImpl })).rejects.toBeInstanceOf(CloudinaryError);
  });
});

describe('listImagePublicIds', () => {
  it('follows every page', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ resources: [{ public_id: 'p/a' }], next_cursor: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ resources: [{ public_id: 'p/b' }] }));

    const ids = await listImagePublicIds(config, 'p/', { fetchImpl });
    expect([...ids].sort()).toEqual(['p/a', 'p/b']);
    const [firstUrl, firstInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toContain('/resources/image/upload?prefix=p%2F&max_results=500');
    expect(new Headers(firstInit.headers).get('authorization')).toBe(`Basic ${btoa('1234:shh')}`);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('next_cursor=c1');
  });
});
