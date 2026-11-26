import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, type Query } from './helpers/fakeDb';

const REVIEW_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_REVIEW_ID = '88888888-8888-4888-8888-888888888888';
const PHOTO_ID = '66666666-6666-4666-8666-666666666666';
const PRIVATE = `reviews-private/${REVIEW_ID}/${PHOTO_ID}`;
const PUBLIC = `reviews/${REVIEW_ID}/${PHOTO_ID}-1795000000`;

/** What happened, in order: transaction edges, statements and Cloudinary calls. */
const events: string[] = [];
const stand = vi.hoisted(() => ({ db: null as unknown, admin: true as boolean }));
const audit = vi.hoisted(() => vi.fn(async () => undefined));
const forgetReviews = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('../src/lib/server/db')>()),
  db: () => stand.db,
  serviceDb: () => stand.db,
  // The real transaction() needs a pool; this one keeps its contract: begin, the work, commit or rollback.
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    events.push('begin');
    try {
      const out = await fn(stand.db);
      events.push('commit');
      return out;
    } catch (err) {
      events.push('rollback');
      throw err;
    }
  },
}));
vi.mock('@/lib/server/adminAuth', () => ({
  requireAdmin: async () => (stand.admin ? { user: { id: 'u1' }, db: { run: async () => 1 } } : null),
}));
vi.mock('@/lib/server/shipping/http', async (original) => ({
  ...(await original<typeof import('../src/lib/server/shipping/http')>()),
  audit,
}));
vi.mock('@/lib/server/reviews/store', () => ({ forgetReviews }));

const route = await import('../src/pages/api/admin/reviews/[id]/photos/[photoId]');
const { removeReviewPhoto } = await import('../src/lib/server/reviews/photos');

/** Cloudinary's destroy, recorded into `events`; `fail` makes it answer an error. */
function cloudinary(fail = false) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const form = init?.body as FormData;
    const type = form.get('type') ? 'private' : 'public';
    events.push(`destroy ${type} ${String(form.get('public_id'))}`);
    if (!String(input).endsWith('/image/destroy')) throw new Error(`unexpected ${String(input)}`);
    if (fail) return Response.json({ error: { message: 'Cloudinary is down' } }, { status: 500 });
    return Response.json({ result: 'ok' });
  });
}

/** One photo of one review. The photo answers only to its own review's id. */
function photoDb(review: Record<string, unknown> | null = { source: 'customer', status: 'pending', admin_edited_at: null }) {
  const photo = { id: PHOTO_ID, private_public_id: PRIVATE, public_public_id: PUBLIC };
  const matches = (q: Query) => q.values.includes(PHOTO_ID) && q.values.includes(REVIEW_ID);
  const { db } = fakeDb({
    query: (q) => {
      const text = q.text.trim();
      if (text.includes('for update')) {
        events.push('lock review');
        return review;
      }
      if (text.startsWith('delete from public.review_photos')) {
        events.push('delete photo row');
        return text.includes('returning') ? (matches(q) ? photo : null) : 1;
      }
      if (text.startsWith('select') && text.includes('from public.review_photos')) return matches(q) ? photo : null;
      return undefined;
    },
  });
  return db;
}

const DELETE = (id: string, photoId: string) =>
  (route.DELETE as unknown as (c: unknown) => Promise<Response>)({
    params: { id, photoId },
    request: new Request('http://x/', { method: 'DELETE' }),
    cookies: {},
  });

beforeEach(() => {
  vi.stubEnv('CLOUDINARY_URL', 'cloudinary://key:secret@testcloud');
  events.length = 0;
  stand.admin = true;
  stand.db = photoDb();
  audit.mockClear();
  forgetReviews.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Admin › Quitar foto (DELETE /api/admin/reviews/[id]/photos/[photoId])', () => {
  it('is for the admin only', async () => {
    stand.admin = false;
    const fetchImpl = cloudinary();
    vi.stubGlobal('fetch', fetchImpl);
    expect((await DELETE(REVIEW_ID, PHOTO_ID)).status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('refuses ids that are not uuids', async () => {
    const fetchImpl = cloudinary();
    vi.stubGlobal('fetch', fetchImpl);
    expect((await DELETE('not-a-uuid', PHOTO_ID)).status).toBe(400);
    expect((await DELETE(REVIEW_ID, '1; drop table')).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a photo of another review is a 404, and nothing is destroyed', async () => {
    const fetchImpl = cloudinary();
    vi.stubGlobal('fetch', fetchImpl);
    const res = await DELETE(OTHER_REVIEW_ID, PHOTO_ID);
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it('destroys both copies, then the row; audits and forgets the cached pages', async () => {
    vi.stubGlobal('fetch', cloudinary());
    const res = await DELETE(REVIEW_ID, PHOTO_ID);
    expect(res.status).toBe(200);
    expect(events).toEqual([`destroy public ${PUBLIC}`, `destroy private ${PRIVATE}`, 'delete photo row']);
    expect(audit).toHaveBeenCalledWith(expect.anything(), 'remove_review_photo', 'reviews', REVIEW_ID, { photoId: PHOTO_ID });
    expect(forgetReviews).toHaveBeenCalledTimes(1);
  });

  it('Cloudinary down: the row stays (press again), and the reason is said', async () => {
    vi.stubGlobal('fetch', cloudinary(true));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await DELETE(REVIEW_ID, PHOTO_ID);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('sigue en la opinión');
    expect(events).not.toContain('delete photo row');
    expect(forgetReviews).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("the customer's own photo removal", () => {
  it('locks the review, checks it again, deletes the row, and only then destroys the file', async () => {
    const fetchImpl = cloudinary() as unknown as typeof fetch;
    await removeReviewPhoto(stand.db as never, REVIEW_ID, PHOTO_ID, { fetchImpl });
    expect(events).toEqual(['begin', 'lock review', 'delete photo row', 'commit', `destroy private ${PRIVATE}`]);
  });

  it('a review Meili closed meanwhile refuses inside the lock: nothing deleted, nothing destroyed', async () => {
    stand.db = photoDb({ source: 'customer', status: 'pending', admin_edited_at: '2026-11-26T10:00:00+00:00' });
    const fetchImpl = cloudinary();
    await expect(removeReviewPhoto(stand.db as never, REVIEW_ID, PHOTO_ID, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({
      status: 409,
      message: 'REVIEW_CLOSED',
    });
    expect(events).toEqual(['begin', 'lock review', 'rollback']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a photo that is not this review’s is a 404', async () => {
    const fetchImpl = cloudinary();
    await expect(removeReviewPhoto(stand.db as never, OTHER_REVIEW_ID, PHOTO_ID, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({
      status: 404,
    });
    expect(events.at(-1)).toBe('rollback');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a file Cloudinary will not destroy is logged; the photo is still off the review', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await removeReviewPhoto(stand.db as never, REVIEW_ID, PHOTO_ID, { fetchImpl: cloudinary(true) as unknown as typeof fetch });
    expect(events).toContain('commit');
    expect(log).toHaveBeenCalledWith('[reviews] removed photo left in Cloudinary', PRIVATE, expect.anything());
    log.mockRestore();
  });
});
