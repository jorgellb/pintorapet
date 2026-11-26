import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, type Query } from './helpers/fakeDb';
import { photoType } from '../src/lib/server/commissionPhotos';
import {
  adminReviewSchema,
  defaultAuthorName,
  productReviewSummary,
  reviewInputSchema,
  reviewKind,
  reviewPhotoAlt,
  reviewPatchSchema,
  type PublicReview,
} from '../src/lib/domain/reviews';
import { openReviewLink, reviewEligible, reviewKey, reviewUrl } from '../src/lib/server/reviews/link';
import { addReviewPhoto, publishPhotos } from '../src/lib/server/reviews/photos';
import { hideReview, deleteReview, publishReview, submitCustomerReview, updateReview } from '../src/lib/server/reviews/store';
import { renderTemplate } from '../src/lib/server/commerce/outbox';
import { mapPgError } from '../src/lib/server/commerce/pgErrors';
import { CommerceError } from '../src/lib/server/commerce/errors';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORDER_ID = '22222222-2222-4222-8222-222222222222';
const REVIEW_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_PRODUCT_ID = '55555555-5555-4555-8555-555555555555';
const PHOTO_ID = '66666666-6666-4666-8666-666666666666';
const SEEN = '2026-11-26T10:00:00.123456+00:00';

beforeEach(() => {
  vi.stubEnv('REVIEW_LINK_SECRET', 'test-secret-for-review-links');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('CLOUDINARY_URL', 'cloudinary://key:secret@testcloud');
  vi.stubEnv('SITE_URL', 'https://petsdrawings.test');
});
afterEach(() => vi.unstubAllEnvs());

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  reference: 'PD-ABC123',
  locale: 'es',
  payment_status: 'paid',
  paid_at: daysAgo(10),
  commission_request_id: null,
  ...over,
});

const reviewRow = (over: Record<string, unknown> = {}) => ({
  id: REVIEW_ID,
  status: 'pending',
  rating: 5,
  body: 'Preciosa',
  author_name: 'Ana G.',
  city: '',
  pet_name: 'Lola',
  product_id: null,
  locale: 'es',
  admin_edited_at: null,
  ...over,
});

/** A db that knows one order (and optionally its review), answering by the table in the SQL. */
function orderDb(opts: { order?: Record<string, unknown> | null; review?: Record<string, unknown> | null; products?: string[]; extra?: (q: Query) => unknown } = {}) {
  const order = opts.order === undefined ? orderRow() : opts.order;
  const written: Query[] = [];
  const { db, queries } = fakeDb({
    query: (q) => {
      const extra = opts.extra?.(q);
      if (extra !== undefined) return extra;
      if (/^\s*(insert|update|delete)/i.test(q.text)) {
        written.push(q);
        if (q.text.includes('insert into public.reviews')) return { id: REVIEW_ID };
        // Naming a photo's public copy: a row with no id yet takes the one offered.
        if (q.text.includes('coalesce(public_public_id')) {
          return { public_public_id: q.values.find((v) => typeof v === 'string' && v.startsWith('reviews/')) };
        }
        return 1;
      }
      if (q.text.includes('from public.orders')) return order;
      if (q.text.includes('from public.order_items')) {
        return (opts.products ?? [PRODUCT_ID]).map((id) => ({ product_id: id, title: 'Taza Pug', bucket: null, object_path: null }));
      }
      if (q.text.includes('from public.review_photos')) return [];
      if (q.text.includes('from public.reviews')) return opts.review ?? null;
      return undefined;
    },
  });
  return { db, queries, written };
}

const validInput = (over: Record<string, unknown> = {}) =>
  reviewInputSchema.parse({
    reference: 'PD-ABC123',
    key: reviewKey(ORDER_ID),
    rating: 5,
    body: 'Muy bonita',
    authorName: 'Ana G.',
    locale: 'es',
    consent: true,
    ...over,
  });

describe('review link', () => {
  it('reviewKey is stable and differs per order', () => {
    expect(reviewKey(ORDER_ID)).toBe(reviewKey(ORDER_ID));
    expect(reviewKey(ORDER_ID)).not.toBe(reviewKey(OTHER_ORDER_ID));
    expect(reviewKey(ORDER_ID)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reviewKey(ORDER_ID, 'another-secret')).not.toBe(reviewKey(ORDER_ID));
  });

  it('falls back to BETTER_AUTH_SECRET and throws when neither secret is set', () => {
    vi.stubEnv('REVIEW_LINK_SECRET', '');
    vi.stubEnv('BETTER_AUTH_SECRET', 'auth-secret');
    expect(reviewKey(ORDER_ID)).toBe(reviewKey(ORDER_ID, 'auth-secret'));
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    expect(() => reviewKey(ORDER_ID)).toThrow();
  });

  it('builds the link in each language', () => {
    const es = reviewUrl({ id: ORDER_ID, reference: 'PD-ABC123', locale: 'es' });
    const en = reviewUrl({ id: ORDER_ID, reference: 'PD-ABC123', locale: 'en' });
    expect(es).toBe(`https://petsdrawings.test/es/opinion/?r=PD-ABC123&k=${reviewKey(ORDER_ID)}`);
    expect(en).toBe(`https://petsdrawings.test/en/review/?r=PD-ABC123&k=${reviewKey(ORDER_ID)}`);
  });

  it('opens the order with its link', async () => {
    const { db } = orderDb({ review: reviewRow() });
    const order = await openReviewLink(db, 'PD-ABC123', reviewKey(ORDER_ID));
    expect(order).toMatchObject({ id: ORDER_ID, reference: 'PD-ABC123', kind: 'product' });
    expect(order?.products.map((p) => p.id)).toEqual([PRODUCT_ID]);
    expect(order?.review).toMatchObject({ id: REVIEW_ID, editable: true });
  });

  it('link refuses a tampered key / an expired order (121 days) / a refunded order', async () => {
    const tampered = reviewKey(ORDER_ID).slice(0, -1) + (reviewKey(ORDER_ID).endsWith('A') ? 'B' : 'A');
    expect(await openReviewLink(orderDb().db, 'PD-ABC123', tampered)).toBeNull();
    expect(await openReviewLink(orderDb().db, 'PD-ABC123', 'short')).toBeNull();
    // Another order's key.
    expect(await openReviewLink(orderDb().db, 'PD-ABC123', reviewKey(OTHER_ORDER_ID))).toBeNull();
    // An unknown reference answers like a wrong key.
    expect(await openReviewLink(orderDb({ order: null }).db, 'PD-NOPE', reviewKey(ORDER_ID))).toBeNull();

    const key = reviewKey(ORDER_ID);
    expect(await openReviewLink(orderDb({ order: orderRow({ paid_at: daysAgo(121) }) }).db, 'PD-ABC123', key)).toBeNull();
    expect(await openReviewLink(orderDb({ order: orderRow({ paid_at: daysAgo(119) }) }).db, 'PD-ABC123', key)).not.toBeNull();
    expect(await openReviewLink(orderDb({ order: orderRow({ payment_status: 'refunded' }) }).db, 'PD-ABC123', key)).toBeNull();
    expect(await openReviewLink(orderDb({ order: orderRow({ payment_status: 'cancelled' }) }).db, 'PD-ABC123', key)).toBeNull();
    expect(await openReviewLink(orderDb({ order: orderRow({ payment_status: 'pending_session', paid_at: null }) }).db, 'PD-ABC123', key)).toBeNull();
    expect(await openReviewLink(orderDb({ order: orderRow({ payment_status: 'partially_refunded' }) }).db, 'PD-ABC123', key)).not.toBeNull();
  });

  it('a refused link reads nothing but the order row', async () => {
    const { db, queries } = orderDb();
    await openReviewLink(db, 'PD-ABC123', 'nope-nope-nope-nope');
    expect(queries).toHaveLength(1);
  });

  it('eligibility needs payment and the 120 days', () => {
    expect(reviewEligible({ payment_status: 'paid', paid_at: daysAgo(1) })).toBe(true);
    expect(reviewEligible({ payment_status: 'paid', paid_at: null })).toBe(false);
    expect(reviewEligible({ payment_status: 'paid', paid_at: daysAgo(121) })).toBe(false);
    expect(reviewEligible({ payment_status: 'refunded', paid_at: daysAgo(1) })).toBe(false);
  });
});

describe('review domain', () => {
  it("defaultAuthorName('Ana García López') === 'Ana G.' and ('Meili') === 'Meili'", () => {
    expect(defaultAuthorName('Ana García López')).toBe('Ana G.');
    expect(defaultAuthorName('Meili')).toBe('Meili');
    expect(defaultAuthorName('  lucía   ñandú ')).toBe('lucía Ñ.');
    expect(defaultAuthorName('')).toBe('');
  });

  it('reviewInputSchema refuses consent false, 1501 chars, rating 0', () => {
    const base = { reference: 'PD-ABC123', key: reviewKey(ORDER_ID), body: 'Bien', authorName: 'Ana G.', locale: 'es', consent: true };
    expect(reviewInputSchema.safeParse(base).success).toBe(true);
    expect(reviewInputSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, body: 'x'.repeat(1501) }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, body: 'x'.repeat(1500) }).success).toBe(true);
    expect(reviewInputSchema.safeParse({ ...base, rating: 0 }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, rating: 6 }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, rating: null }).success).toBe(true);
    expect(reviewInputSchema.safeParse({ ...base, body: '   ' }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, authorName: '' }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, petName: 'p'.repeat(61) }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, city: 'c'.repeat(81) }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, verified: true }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, productId: 'not-a-uuid' }).success).toBe(false);
  });

  it('the body is trimmed', () => {
    expect(validInput({ body: '  Muy bonita  ' }).body).toBe('Muy bonita');
  });

  it('adminReviewSchema takes up to three photos and never a verified flag', () => {
    const base = { authorName: 'Lucía', body: 'Preciosa', locale: 'es' };
    const id = () => crypto.randomUUID();
    expect(adminReviewSchema.safeParse({ ...base, photoIds: [id(), id(), id()] }).success).toBe(true);
    expect(adminReviewSchema.safeParse({ ...base, photoIds: [id(), id(), id(), id()] }).success).toBe(false);
    expect(adminReviewSchema.safeParse({ ...base, verified: true }).success).toBe(false);
    expect(adminReviewSchema.parse(base)).toMatchObject({ rating: null, featured: false, photoIds: [], publish: false });
  });

  it('photo alt text, with fallbacks when the pet is empty', () => {
    expect(reviewPhotoAlt({ authorName: 'Ana G.', petName: 'Lola' }, 'es')).toBe('Retrato de Lola en casa de Ana G.');
    expect(reviewPhotoAlt({ authorName: 'Ana G.', petName: '' }, 'es')).toBe('Retrato en casa de Ana G.');
    expect(reviewPhotoAlt({ authorName: 'Ana G.', petName: 'Lola' }, 'en')).toBe("Portrait of Lola at Ana G.'s home");
    expect(reviewPhotoAlt({ authorName: 'Ana G.', petName: ' ' }, 'en')).toBe("Portrait at Ana G.'s home");
  });

  it('a review is about a commission, a product or the order in general', () => {
    expect(reviewKind(PRODUCT_ID, null)).toBe('product');
    expect(reviewKind(null, null)).toBe('general');
    expect(reviewKind(null, 'c1')).toBe('commission');
    expect(reviewKind(PRODUCT_ID, 'c1')).toBe('commission');
  });

  const pub = (id: string, rating: number | null, verified: boolean): PublicReview => ({
    id,
    authorName: 'A',
    city: '',
    petName: '',
    body: 'b',
    locale: 'es',
    rating,
    verified,
    photos: [],
    publishedAt: '2026-11-26T00:00:00Z',
    productId: PRODUCT_ID,
    kind: 'product',
  });

  it('the rating summary: visible over all starred reviews, JSON-LD over all verified starred ones, items at most 10', () => {
    const list = [pub('a', 5, true), pub('b', 3, false), pub('c', null, true), pub('d', 4, true)];
    const summary = productReviewSummary(list);
    expect(summary.reviews).toHaveLength(4);
    expect(summary).toMatchObject({ average: 4, count: 3 });
    expect(summary.jsonLd.items.map((r) => r.id)).toEqual(['a', 'd']);
    expect(summary.jsonLd).toMatchObject({ average: 4.5, count: 2 });

    // Ruling W: past ten, the figures still cover every verified starred review.
    const many = Array.from({ length: 14 }, (_, i) => pub(`r${i}`, i % 2 ? 5 : 4, true));
    const capped = productReviewSummary(many);
    expect(capped.jsonLd.items.map((r) => r.id)).toEqual(many.slice(0, 10).map((r) => r.id));
    expect(capped.jsonLd.count).toBe(14);
    expect(capped.jsonLd.average).toBe(4.5);
    expect(capped.count).toBe(14);

    expect(productReviewSummary([pub('x', null, true)])).toMatchObject({ average: null, count: 0, jsonLd: { average: null, count: 0, items: [] } });
  });

  it('the rating summary takes the true figures from the database when the list is cut short', () => {
    const shown = [pub('n1', 5, false)];
    const items = [pub('v1', 4, true), pub('v2', 5, true)];
    const summary = productReviewSummary(shown, {
      visible: { average: 4.2, count: 300 },
      verified: { average: 4.4, count: 120 },
      items,
    });
    expect(summary).toMatchObject({ average: 4.2, count: 300 });
    expect(summary.jsonLd).toMatchObject({ average: 4.4, count: 120 });
    expect(summary.jsonLd.items.map((r) => r.id)).toEqual(['v1', 'v2']);
  });

  it('a patch is partial and strict', () => {
    expect(reviewPatchSchema.safeParse({ city: 'Madrid' }).success).toBe(true);
    expect(reviewPatchSchema.safeParse({ verified: true }).success).toBe(false);
    expect(reviewPatchSchema.safeParse({}).success).toBe(true);
  });
});

describe('photos', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 not a photo');
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

  it('photoType refuses a renamed PDF', () => {
    expect(photoType(pdf)).toBeNull();
    expect(photoType(jpeg)).toBe('image/jpeg');
  });

  it('addReviewPhoto refuses a renamed PDF and a file over the limit, before touching anything', async () => {
    const { db, queries } = fakeDb();
    const fetchImpl = vi.fn();
    await expect(addReviewPhoto(db, REVIEW_ID, { bytes: pdf, contentType: 'image/jpeg' }, { fetchImpl })).rejects.toMatchObject({ code: 'VALIDATION', message: 'NOT_A_PHOTO' });
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(jpeg);
    await expect(addReviewPhoto(db, REVIEW_ID, { bytes: big, contentType: 'image/jpeg' }, { fetchImpl })).rejects.toMatchObject({ message: 'PHOTO_TOO_LARGE' });
    await expect(addReviewPhoto(db, REVIEW_ID, { bytes: new Uint8Array(0), contentType: 'image/jpeg' }, { fetchImpl })).rejects.toMatchObject({ message: 'PHOTO_TOO_LARGE' });
    expect(queries).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/** A Cloudinary stand-in: records every call, answers destroy and upload, serves the download. */
function cloudinaryStub({ missing = false, failDestroy }: { missing?: boolean; failDestroy?: (publicId: string) => boolean } = {}) {
  const calls: Array<{ kind: 'destroy' | 'upload' | 'download'; publicId: string; type: string | null; url: string }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/image/download')) {
      calls.push({ kind: 'download', publicId: new URL(url).searchParams.get('public_id') ?? '', type: new URL(url).searchParams.get('type'), url });
      if (missing) return new Response('not found', { status: 404 });
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 });
    }
    const form = init?.body as FormData;
    const publicId = String(form.get('public_id'));
    const type = form.get('type') ? String(form.get('type')) : null;
    if (url.endsWith('/image/destroy')) {
      calls.push({ kind: 'destroy', publicId, type, url });
      if (failDestroy?.(publicId)) return Response.json({ error: { message: 'Cloudinary is down' } }, { status: 500 });
      return Response.json({ result: 'ok' });
    }
    calls.push({ kind: 'upload', publicId, type, url });
    return Response.json({ public_id: publicId, bytes: 4 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('moderation', () => {
  const photoRows = [
    { id: PHOTO_ID, private_public_id: `reviews-private/${REVIEW_ID}/${PHOTO_ID}`, public_public_id: `reviews/${REVIEW_ID}/${PHOTO_ID}` },
  ];

  it('hide hides first, then destroys the public copies, keeps the private ones', async () => {
    const cloud = cloudinaryStub();
    let hiddenAfterCalls = -1;
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'published' };
        if (q.text.includes("status = 'hidden'")) hiddenAfterCalls = cloud.calls.length;
        if (q.text.includes('from public.review_photos')) return photoRows;
        return undefined;
      },
    });
    expect(await hideReview(db, REVIEW_ID, { fetchImpl: cloud.fetchImpl })).toEqual({});
    // Privacy first: the review was hidden before Cloudinary was asked anything.
    expect(hiddenAfterCalls).toBe(0);
    expect(cloud.calls).toEqual([expect.objectContaining({ kind: 'destroy', publicId: `reviews/${REVIEW_ID}/${PHOTO_ID}`, type: null })]);
    expect(cloud.calls.some((c) => c.publicId.startsWith('reviews-private/'))).toBe(false);
    // The row forgets the public copy, not the private one, and the review is hidden.
    expect(written.some((q) => q.text.includes('public_public_id = null') && !q.text.includes('private_public_id'))).toBe(true);
    expect(written.some((q) => q.text.includes("status = 'hidden'"))).toBe(true);
  });

  it('hide with Cloudinary down: hidden anyway, the copy id kept for a retry, and a warning for Admin', async () => {
    const SECOND = '77777777-7777-4777-8777-777777777777';
    const rows = [
      photoRows[0]!,
      { id: SECOND, private_public_id: `reviews-private/${REVIEW_ID}/${SECOND}`, public_public_id: `reviews/${REVIEW_ID}/${SECOND}` },
    ];
    // Only the first copy fails: the second is still tried and forgotten.
    const cloud = cloudinaryStub({ failDestroy: (id) => id === rows[0]!.public_public_id });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'published' };
        if (/^\s*select/i.test(q.text) && q.text.includes('from public.review_photos')) return rows;
        return undefined;
      },
    });
    const result = await hideReview(db, REVIEW_ID, { fetchImpl: cloud.fetchImpl });
    expect(result).toEqual({ warning: 'Ocultada; quedan fotos por quitar de Cloudinary, vuelve a pulsar Ocultar' });
    expect(written[0]?.text).toContain("status = 'hidden'");
    expect(cloud.calls.filter((c) => c.kind === 'destroy').map((c) => c.publicId)).toEqual([rows[0]!.public_public_id, rows[1]!.public_public_id]);
    const forgotten = written.filter((q) => q.text.includes('public_public_id = null')).map((q) => q.values);
    expect(forgotten).toEqual([[SECOND]]);
    log.mockRestore();
  });

  it('delete with Cloudinary down: the review is left hidden with its row and photo ids, and the error says so', async () => {
    const cloud = cloudinaryStub({ failDestroy: () => true });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'published' };
        if (/^\s*select/i.test(q.text) && q.text.includes('from public.review_photos')) return photoRows;
        return undefined;
      },
    });
    const refused = deleteReview(db, REVIEW_ID, { fetchImpl: cloud.fetchImpl });
    await expect(refused).rejects.toMatchObject({ status: 502, message: expect.stringContaining('está oculta') });
    await expect(refused).rejects.toMatchObject({ message: expect.stringContaining('vuelve a pulsar Borrar') });
    expect(written.map((q) => q.text.trim().split('\n')[0])).toEqual([expect.stringContaining("status = 'hidden'")]);
    expect(written.some((q) => q.text.includes('delete from public.reviews') || q.text.includes('delete from public.review_photos'))).toBe(false);
    log.mockRestore();
  });

  it('a retried delete after Cloudinary came back finishes the job', async () => {
    const cloud = cloudinaryStub();
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'hidden' };
        if (/^\s*select/i.test(q.text) && q.text.includes('from public.review_photos')) return photoRows;
        return undefined;
      },
    });
    await deleteReview(db, REVIEW_ID, { fetchImpl: cloud.fetchImpl });
    expect(written[0]?.text).toContain("status = 'hidden'");
    expect(written.some((q) => q.text.includes('delete from public.review_photos'))).toBe(true);
    expect(written.at(-1)?.text).toContain('delete from public.reviews');
  });

  it('publish copies to reviews/<id>/<photo>-<seconds>, a fresh id each time', async () => {
    const cloud = cloudinaryStub();
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'pending' };
        if (q.text.includes('from public.review_photos')) return [{ ...photoRows[0], public_public_id: null }];
        return undefined;
      },
    });
    await publishReview(db, REVIEW_ID, SEEN, { fetchImpl: cloud.fetchImpl });
    expect(cloud.calls.map((c) => c.kind)).toEqual(['download', 'upload']);
    expect(cloud.calls[0]).toMatchObject({ publicId: `reviews-private/${REVIEW_ID}/${PHOTO_ID}`, type: 'authenticated' });
    // The copy is public (no authenticated type) and lands in the reviews folder.
    const copyId = new RegExp(`^reviews/${REVIEW_ID}/${PHOTO_ID}-\\d{10}$`);
    expect(cloud.calls[1]).toMatchObject({ publicId: expect.stringMatching(copyId), type: null });
    const update = written.find((q) => q.text.includes('set public_public_id'));
    expect(update?.values).toContainEqual(expect.stringMatching(copyId));
    // The id the row was given is the one uploaded.
    expect(update?.values).toContain(cloud.calls[1]!.publicId);
    expect(written.some((q) => q.text.includes("status = 'published'"))).toBe(true);
  });

  it('publish writes the copy id to the row before uploading, so no copy exists the row does not know', async () => {
    const cloud = cloudinaryStub();
    let callsWhenNamed = -1;
    const { db } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'pending' };
        if (q.text.includes('coalesce(public_public_id')) callsWhenNamed = cloud.calls.length;
        if (/^\s*select/i.test(q.text) && q.text.includes('from public.review_photos')) return [{ ...photoRows[0], public_public_id: null }];
        return undefined;
      },
    });
    await publishReview(db, REVIEW_ID, SEEN, { fetchImpl: cloud.fetchImpl });
    expect(callsWhenNamed).toBe(0);
    expect(cloud.calls.map((c) => c.kind)).toEqual(['download', 'upload']);
  });

  it('publish closes the review to its author first, then copies, then flips the status', async () => {
    const cloud = cloudinaryStub();
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'pending' };
        if (q.text.includes('from public.review_photos')) return [{ ...photoRows[0], public_public_id: null }];
        return undefined;
      },
    });
    await publishReview(db, REVIEW_ID, SEEN, { fetchImpl: cloud.fetchImpl });
    const order = written.map((q) =>
      q.text.includes('admin_edited_at') ? 'close' : q.text.includes('set public_public_id') ? 'copy' : q.text.includes("status = 'published'") ? 'flip' : 'other',
    );
    expect(order).toEqual(['close', 'copy', 'flip']);
    // The guard is the updated_at Meili saw.
    const close = written[0]!;
    expect(close.text).toContain('updated_at =');
    expect(close.values).toContain(SEEN);
  });

  it('a customer edit between load and publish is refused, and nothing gets published', async () => {
    const cloud = cloudinaryStub();
    // The customer's edit moved updated_at on: the guarded statement matches no row.
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'pending' };
        if (q.text.includes('set admin_edited_at')) return null;
        if (q.text.includes('from public.review_photos')) return [{ ...photoRows[0], public_public_id: null }];
        return undefined;
      },
    });
    await expect(publishReview(db, REVIEW_ID, SEEN, { fetchImpl: cloud.fetchImpl })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'La opinión ha cambiado mientras la leías; vuelve a cargarla.',
    });
    expect(cloud.calls).toHaveLength(0);
    expect(written.some((q) => q.text.includes("status = 'published'") || q.text.includes('public_public_id'))).toBe(false);
  });

  it('a private photo that no longer exists is dropped and does not block publishing', async () => {
    const cloud = cloudinaryStub({ missing: true });
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'pending' };
        if (/^\s*select/i.test(q.text) && q.text.includes('from public.review_photos')) return [{ ...photoRows[0], public_public_id: null }];
        return undefined;
      },
    });
    await publishReview(db, REVIEW_ID, SEEN, { fetchImpl: cloud.fetchImpl });
    expect(cloud.calls.map((c) => c.kind)).toEqual(['download']);
    expect(written.some((q) => q.text.includes('delete from public.review_photos') && q.values.includes(PHOTO_ID))).toBe(true);
    expect(written.some((q) => q.text.includes("status = 'published'"))).toBe(true);
  });

  it('a retry reuses the id already on the row (no new id, no second copy): the upload does not overwrite', async () => {
    const cloud = cloudinaryStub();
    const kept = photoRows[0]!.public_public_id;
    const { db, queries } = orderDb({
      extra: (q) => {
        // The row already holds an id from the attempt that failed: coalesce keeps it.
        if (q.text.includes('coalesce(public_public_id')) return { public_public_id: kept };
        if (/^\s*select/i.test(q.text) && q.text.includes('from public.review_photos')) return photoRows;
        return undefined;
      },
    });
    await publishPhotos(db, REVIEW_ID, { fetchImpl: cloud.fetchImpl });
    expect(cloud.calls.map((c) => [c.kind, c.publicId])).toEqual([
      ['download', photoRows[0]!.private_public_id],
      ['upload', kept],
    ]);
    const upload = (cloud.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![1] as RequestInit;
    expect((upload.body as FormData).get('overwrite')).toBe('false');
    // Only the coalescing write touches the id: nothing sets a second one afterwards.
    expect(queries.filter((q) => q.text.includes('set public_public_id'))).toHaveLength(1);
  });

  it('publish stays unpublished when Cloudinary fails', async () => {
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'pending' };
        if (q.text.includes('from public.review_photos')) return [{ ...photoRows[0], public_public_id: null }];
        return undefined;
      },
    });
    const failing = vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    await expect(publishReview(db, REVIEW_ID, SEEN, { fetchImpl: failing })).rejects.toBeInstanceOf(CommerceError);
    expect(written.some((q) => q.text.includes("status = 'published'"))).toBe(false);
  });

  it('delete destroys private and public copies, then the review', async () => {
    const cloud = cloudinaryStub();
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('select status from public.reviews')) return { status: 'hidden' };
        if (q.text.includes('from public.review_photos')) return photoRows;
        return undefined;
      },
    });
    await deleteReview(db, REVIEW_ID, { fetchImpl: cloud.fetchImpl });
    expect(cloud.calls.map((c) => [c.kind, c.type])).toEqual([
      ['destroy', null],
      ['destroy', 'authenticated'],
    ]);
    expect(written.at(-1)?.text).toContain('delete from public.reviews');
  });

  it('a missing review is a 404', async () => {
    const { db } = orderDb({ extra: (q) => (q.text.includes('select status from public.reviews') ? null : undefined) });
    await expect(hideReview(db, REVIEW_ID)).rejects.toMatchObject({ status: 404 });
  });
});

describe('customer submit', () => {
  const ctx = (db: ReturnType<typeof orderDb>['db']) => ({ ip: '203.0.113.9', db });

  it('creates a verified, pending review and tells Meili once', async () => {
    const { db, written } = orderDb();
    const result = await submitCustomerReview(validInput({ productId: PRODUCT_ID }), ctx(db));
    expect(result).toEqual({ id: REVIEW_ID, created: true });
    const insert = written.find((q) => q.text.includes('insert into public.reviews'));
    expect(insert?.values).toEqual(expect.arrayContaining(['customer', 'pending', 'product', ORDER_ID, PRODUCT_ID, true]));
    const notice = written.find((q) => q.text.includes('insert into public.notification_outbox'));
    expect(notice?.values).toEqual(expect.arrayContaining([`review_admin:${REVIEW_ID}`, 'review_admin']));
  });

  it('a failing notice is a hard failure of the submit, not swallowed (the rollback itself is in reviewsSubmitTx.test.ts)', async () => {
    const { db, written } = orderDb({
      extra: (q) => {
        if (q.text.includes('insert into public.notification_outbox')) throw new Error('outbox down');
        return undefined;
      },
    });
    await expect(submitCustomerReview(validInput(), ctx(db))).rejects.toBeInstanceOf(CommerceError);
    expect(written.some((q) => q.text.includes('insert into public.reviews'))).toBe(true);
  });

  it('a commission order gives a commission review', async () => {
    const { db, written } = orderDb({ order: orderRow({ commission_request_id: 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0' }), products: [] });
    await submitCustomerReview(validInput(), ctx(db));
    const insert = written.find((q) => q.text.includes('insert into public.reviews'));
    expect(insert?.values).toEqual(expect.arrayContaining(['commission', 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0']));
  });

  it('submit refuses a product not in the order', async () => {
    const { db, written } = orderDb();
    await expect(submitCustomerReview(validInput({ productId: OTHER_PRODUCT_ID }), ctx(db))).rejects.toMatchObject({ code: 'VALIDATION', message: 'REVIEW_PRODUCT' });
    expect(written).toHaveLength(0);
  });

  it('submit gives one generic refusal for any bad link', async () => {
    const expired = orderDb({ order: orderRow({ paid_at: daysAgo(200) }) });
    const tampered = orderDb();
    for (const [source, input] of [
      [expired, validInput()],
      [tampered, validInput({ key: reviewKey(OTHER_ORDER_ID) })],
    ] as const) {
      await expect(submitCustomerReview(input, ctx(source.db))).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'REVIEW_LINK_INVALID', status: 403 });
      expect(source.written).toHaveLength(0);
    }
  });

  it('edits a pending review that Meili has not touched, without a second notice', async () => {
    const { db, written } = orderDb({
      review: reviewRow(),
      extra: (q) => (q.text.includes('update public.reviews') ? { id: REVIEW_ID } : undefined),
    });
    const result = await submitCustomerReview(validInput({ body: 'Mejor aún' }), ctx(db));
    expect(result).toEqual({ id: REVIEW_ID, created: false });
    expect(written.some((q) => q.text.includes('notification_outbox'))).toBe(false);
  });

  it('an edit is agreed to again: consent is required and consent_at is refreshed', async () => {
    // The box is never pre-ticked, and a send without it is refused before anything runs.
    expect(reviewInputSchema.safeParse({ ...validInput(), consent: undefined }).success).toBe(false);
    const { db, queries } = orderDb({
      review: reviewRow(),
      extra: (q) => (q.text.includes('update public.reviews') ? { id: REVIEW_ID } : undefined),
    });
    const before = Date.now();
    await submitCustomerReview(validInput({ body: 'Mejor aún' }), ctx(db));
    const update = queries.find((q) => q.text.includes('update public.reviews'))!;
    expect(update.text).toContain('"consent_at"');
    const stamp = update.values.find((v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) as string;
    expect(Date.parse(stamp)).toBeGreaterThanOrEqual(before);
  });

  it('edit is refused once admin_edited_at is set', async () => {
    const { db, queries } = orderDb({ review: reviewRow({ admin_edited_at: daysAgo(1) }) });
    await expect(submitCustomerReview(validInput(), ctx(db))).rejects.toMatchObject({ code: 'CONFLICT', message: 'REVIEW_CLOSED' });
    expect(queries.some((q) => q.text.includes('update public.reviews'))).toBe(false);
  });

  it('edit is refused once the review is published', async () => {
    const { db } = orderDb({ review: reviewRow({ status: 'published' }) });
    await expect(submitCustomerReview(validInput(), ctx(db))).rejects.toMatchObject({ message: 'REVIEW_CLOSED' });
  });

  it('edit loses a race with Meili: the guarded update touches nothing', async () => {
    const { db } = orderDb({ review: reviewRow(), extra: (q) => (q.text.includes('update public.reviews') ? null : undefined) });
    await expect(submitCustomerReview(validInput(), ctx(db))).rejects.toMatchObject({ message: 'REVIEW_CLOSED' });
  });

  it('two first sends at once: the second is refused, not duplicated', async () => {
    const { db, written } = orderDb({ extra: (q) => (q.text.includes('insert into public.reviews') ? null : undefined) });
    await expect(submitCustomerReview(validInput(), ctx(db))).rejects.toMatchObject({ message: 'REVIEW_CLOSED' });
    expect(written.some((q) => q.text.includes('notification_outbox'))).toBe(false);
  });
});

describe('admin edits', () => {
  const NEXT = '2026-11-26T10:05:00.654321+00:00';
  const editDb = (review: Record<string, unknown> | null, bought = true) => {
    const run: string[] = [];
    const { db, queries } = fakeDb({
      query: (q) => {
        if (q.text.includes('for update')) return review && { fresh: true, ...review };
        if (q.text.includes('from public.order_items')) return bought ? { ok: 1 } : null;
        if (q.text.includes('select updated_at from public.reviews')) return { updated_at: NEXT };
        run.push(q.text);
        return q.text.includes('returning id') ? { id: REVIEW_ID } : 1;
      },
    });
    return { db, queries, run };
  };
  const customerReview = { source: 'customer', order_id: ORDER_ID, product_id: null, commission_request_id: null };

  it("Meili does not change a customer's words or stars", async () => {
    for (const patch of [{ body: 'Otra cosa' }, { rating: 1 }, { locale: 'en' as const }, { photoIds: [PHOTO_ID] }]) {
      const { db, run } = editDb(customerReview);
      await expect(updateReview(db, REVIEW_ID, patch, SEEN)).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(run).toHaveLength(0);
    }
  });

  it('she fixes name, city and pet, and that closes the review to its author', async () => {
    const { db, queries } = editDb(customerReview);
    await updateReview(db, REVIEW_ID, { authorName: 'Ana García', city: 'Madrid' }, SEEN);
    const update = queries.find((q) => q.text.includes('update public.reviews'));
    expect(update?.text).toContain('"admin_edited_at"');
    expect(update?.values).toEqual(expect.arrayContaining(['Ana García', 'Madrid']));
  });

  it('featuring does not count as touching it', async () => {
    const { db, queries } = editDb(customerReview);
    await updateReview(db, REVIEW_ID, { featured: true }, SEEN);
    expect(queries.find((q) => q.text.includes('update public.reviews'))?.text).not.toContain('admin_edited_at');
  });

  it('every change is guarded by the updated_at the page saw, and answers the new one from the same transaction', async () => {
    const { db, queries } = editDb(customerReview);
    expect(await updateReview(db, REVIEW_ID, { featured: true }, SEEN)).toBe(NEXT);
    const lock = queries.find((q) => q.text.includes('for update'))!;
    expect(lock.text).toContain('updated_at =');
    expect(lock.values).toContain(SEEN);
    const update = queries.find((q) => q.text.includes('update public.reviews'))!;
    expect(update.text).toMatch(/where id = \$\d+ and updated_at = \$\d+::timestamptz/);
    expect(update.values).toContain(SEEN);
    // Read after the write: the value that comes back is the one that write made.
    expect(queries.findIndex((q) => q.text.includes('select updated_at'))).toBeGreaterThan(queries.indexOf(update));
  });

  it('a stale page is refused before anything is written', async () => {
    const { db, run } = editDb({ ...customerReview, fresh: false });
    await expect(updateReview(db, REVIEW_ID, { featured: true }, SEEN)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'La opinión ha cambiado mientras la leías; vuelve a cargarla.',
    });
    expect(run).toHaveLength(0);
  });

  it("the product must be one of the order's", async () => {
    const { db, run } = editDb(customerReview, false);
    await expect(updateReview(db, REVIEW_ID, { productId: OTHER_PRODUCT_ID }, SEEN)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(run).toHaveLength(0);
    const ok = editDb(customerReview, true);
    await updateReview(ok.db, REVIEW_ID, { productId: PRODUCT_ID }, SEEN);
    const update = ok.queries.find((q) => q.text.includes('update public.reviews'));
    expect(update?.values).toEqual(expect.arrayContaining([PRODUCT_ID, 'product']));
  });

  it('an admin review is editable in full, with photos from Medios, and never verified', async () => {
    const { db, queries } = editDb({ source: 'admin', order_id: null, product_id: null, commission_request_id: null });
    await updateReview(db, REVIEW_ID, { body: 'Otra', rating: 4, photoIds: [PHOTO_ID] }, SEEN);
    const update = queries.find((q) => q.text.includes('update public.reviews'));
    expect(update?.text).not.toContain('admin_edited_at');
    expect(update?.text).not.toContain('verified');
    expect(queries.some((q) => q.text.includes('delete from public.review_photos'))).toBe(true);
    expect(queries.some((q) => q.text.includes('insert into public.review_photos'))).toBe(true);
  });

  it('an unknown review is a 404', async () => {
    const { db } = editDb(null);
    await expect(updateReview(db, REVIEW_ID, { city: 'x' }, SEEN)).rejects.toMatchObject({ status: 404 });
  });
});

describe('the publish guard holds across a feature toggle', () => {
  const U0 = '2026-11-26T10:00:00.111111+00:00';
  const U1 = '2026-11-26T10:01:00.222222+00:00';
  const U2 = '2026-11-26T10:02:00.333333+00:00';

  /** One review in a database that keeps its updated_at, answering each guard against it. */
  function reviewInDb() {
    const state = { updatedAt: U0, body: 'Preciosa', featured: false, status: 'pending' };
    const { db } = fakeDb({
      query: (q) => {
        const seenNow = q.values.includes(state.updatedAt);
        if (q.text.includes('from public.orders')) return orderRow();
        if (q.text.includes('from public.order_items')) return [{ product_id: PRODUCT_ID, title: 'Taza Pug', bucket: null, object_path: null }];
        if (q.text.includes('from public.review_photos')) return [];
        // The customer's edit (guarded by status, not by a token): it moves updated_at on.
        if (q.text.includes('update public.reviews') && q.text.includes("status = 'pending'")) {
          state.body = String(q.values.find((v) => v === 'Ahora digo otra cosa') ?? state.body);
          state.updatedAt = U1;
          return { id: REVIEW_ID };
        }
        // Admin's lock + check (updateReview).
        if (q.text.includes('for update')) {
          return { source: 'customer', order_id: ORDER_ID, product_id: null, commission_request_id: null, fresh: seenNow };
        }
        // Admin's guarded change (updateReview).
        if (q.text.includes('update public.reviews set') && q.text.includes('"featured"')) {
          // Only a statement that carries the guard can be refused by it.
          if (q.text.includes('updated_at =') && !seenNow) return null;
          state.featured = true;
          state.updatedAt = U2;
          return { id: REVIEW_ID };
        }
        if (q.text.includes('select updated_at from public.reviews')) return { updated_at: state.updatedAt };
        // Publish's guard.
        if (q.text.includes('set admin_edited_at = case')) return seenNow ? { id: REVIEW_ID } : null;
        if (q.text.includes("set status = 'published'")) {
          state.status = 'published';
          return 1;
        }
        if (q.text.includes('select status from public.reviews')) return { status: state.status };
        if (q.text.includes('from public.reviews')) return reviewRow({ body: state.body });
        return undefined;
      },
    });
    return { db, state };
  }

  it('customer edit → feature toggle is refused (409) → publish with the old token is refused too', async () => {
    const { db, state } = reviewInDb();
    // 1. Meili loads the review: the page holds U0. 2. The customer changes the words: U1.
    await submitCustomerReview(validInput({ body: 'Ahora digo otra cosa' }), { ip: '203.0.113.9', db });
    expect(state.updatedAt).toBe(U1);
    // 3. Meili toggles "Destacar en portada" from the page that still shows U0's words.
    await expect(updateReview(db, REVIEW_ID, { featured: true }, U0)).rejects.toMatchObject({ status: 409 });
    expect(state).toMatchObject({ featured: false, updatedAt: U1 });
    // 4. No newer token came back, so publishing still carries U0, and is refused.
    await expect(publishReview(db, REVIEW_ID, U0)).rejects.toMatchObject({
      status: 409,
      message: 'La opinión ha cambiado mientras la leías; vuelve a cargarla.',
    });
    expect(state.status).toBe('pending');
  });

  it('with nothing changed in between, the toggle answers the token the page then publishes with', async () => {
    const { db, state } = reviewInDb();
    const token = await updateReview(db, REVIEW_ID, { featured: true }, U0);
    expect(token).toBe(U2);
    await publishReview(db, REVIEW_ID, token, { fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(state).toMatchObject({ featured: true, status: 'published' });
  });
});

describe('emails', () => {
  it('shipped email text includes the review link when present', () => {
    const url = 'https://petsdrawings.test/es/opinion/?r=PD-ABC123&k=abc';
    const base = { reference: 'PD-ABC123', tracking_code: 'XY123', tracking_url: null };
    expect(renderTemplate('order_shipped_customer', 'es', { ...base, review_url: url }).text).toContain(url);
    expect(renderTemplate('order_shipped_customer', 'en', { ...base, review_url: url }).text).toContain(url);
    expect(renderTemplate('order_shipped_customer', 'es', base).text).not.toContain('opinion');
    expect(renderTemplate('order_shipped_customer', 'es', { ...base, review_url: null }).text).not.toContain('http');
  });

  it('review_admin names the author, quotes the review and links to Admin', () => {
    const mail = renderTemplate('review_admin', 'es', { review_id: REVIEW_ID, name: 'Ana G.', city: 'Madrid', rating: 5, excerpt: 'Preciosa' });
    expect(mail.subject).toContain('Ana G.');
    expect(mail.text).toContain('Preciosa');
    expect(mail.text).toContain(`https://petsdrawings.test/admin/reviews/${REVIEW_ID}/`);
  });

  it('the review errors map to their status', () => {
    expect(mapPgError(new Error('REVIEW_PHOTOS_MAX'))).toMatchObject({ code: 'VALIDATION', status: 400 });
    expect(mapPgError(new Error('REVIEW_LINK_INVALID'))).toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});
