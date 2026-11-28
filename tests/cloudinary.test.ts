import { describe, expect, it, vi } from 'vitest';
import {
  CloudinaryError,
  cloudinaryImageUrl,
  destroyImage,
  jpegDeliveryUrl,
  listImagePublicIds,
  mediaPublicId,
  parseCloudinaryUrl,
  privateDownloadUrl,
  signCloudinaryParams,
  uploadImage,
  uploadPrivateImage,
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

describe('private images (a customer’s photos)', () => {
  it('are uploaded as authenticated, never public', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init!.body as FormData;
      expect(form.get('type')).toBe('authenticated');
      expect(form.get('public_id')).toBe('commissions/CR-1/a');
      // The signature covers the type, so it cannot be changed on the way.
      expect(form.get('signature')).toBe(
        signCloudinaryParams({ overwrite: 'false', public_id: 'commissions/CR-1/a', timestamp: 1_700_000_000, type: 'authenticated' }, 'shh'),
      );
      return jsonResponse({ public_id: 'commissions/CR-1/a', bytes: 12 });
    });
    const out = await uploadPrivateImage(
      config,
      { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg', publicId: 'commissions/CR-1/a' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, now: fixedNow },
    );
    expect(out).toEqual({ publicId: 'commissions/CR-1/a', bytes: 12 });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
  });

  it('are read through a signed download link that expires', () => {
    const url = new URL(privateDownloadUrl(config, 'commissions/CR-1/a', { now: fixedNow, ttlSeconds: 300 }));
    expect(url.origin + url.pathname).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/download');
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({ public_id: 'commissions/CR-1/a', type: 'authenticated', format: 'jpg', api_key: '1234' });
    expect(params.expires_at).toBe(String(1_700_000_000 + 300));
    const { api_key: _key, signature, ...signed } = params;
    expect(signature).toBe(signCloudinaryParams(signed, 'shh'));
  });
});

describe('photoType', () => {
  it('knows a photo by its bytes, not its name', async () => {
    const { photoType } = await import('../src/lib/server/commissionPhotos');
    expect(photoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(photoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png');
    expect(photoType(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(photoType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
  });
});

describe('timeouts', () => {
  const image = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg', publicId: 'a/b' };
  const aborted = () => AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError'));

  it('give uploads 30 s and deletes and lists 10 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/resources/')
        ? jsonResponse({ resources: [] })
        : jsonResponse({ public_id: 'a/b', bytes: 3, result: 'ok' }),
    );
    const deps = { fetchImpl: fetchImpl as unknown as typeof fetch, now: fixedNow };
    await uploadImage(config, image, deps);
    await uploadPrivateImage(config, image, deps);
    await destroyImage(config, 'a/b', deps);
    await listImagePublicIds(config, 'a/', deps);
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([30_000, 30_000, 10_000, 10_000]);
    for (const [, init] of fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    timeout.mockRestore();
  });

  it('fail when the answer is cut off, instead of reading it as empty', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(aborted);
    const fetchImpl = vi.fn(async () => new Response('{"public_id": "a/', { status: 200 }));
    await expect(uploadImage(config, image, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    timeout.mockRestore();
  });

  it('still read an answer that is not JSON as empty when nothing timed out', async () => {
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 500 }));
    await expect(destroyImage(config, 'a/b', { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({
      name: 'CloudinaryError',
      status: 500,
    });
  });
});
