/**
 * The review guards against a real PostgreSQL (the reviews migration, its
 * triggers and grants), built by scripts/aiven/apply-schema.py. Skipped without
 * TEST_DATABASE_URL:
 *   TEST_DATABASE_URL=postgresql://avnadmin:localpw@127.0.0.1:55440/defaultdb pnpm exec vitest run tests/reviews.integration.test.ts
 * Cloudinary is never called: every fetch is a stub. What it creates it deletes.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('reviews against PostgreSQL', () => {
  let dbm: typeof import('../src/lib/server/db');
  let store: typeof import('../src/lib/server/reviews/store');
  let photos: typeof import('../src/lib/server/reviews/photos');
  let link: typeof import('../src/lib/server/reviews/link');
  let domain: typeof import('../src/lib/domain/reviews');
  const adminId = randomUUID();
  const reference = `PD-IT-${Date.now().toString(36).toUpperCase()}`;
  let orderId = '';
  let reviewId = '';

  const updatedAt = async (id = reviewId) =>
    (await dbm.db().one<{ updated_at: string }>`select updated_at from public.reviews where id = ${id}`)!.updated_at;
  const asAdmin = <T>(fn: (tx: import('../src/lib/server/db').Db) => Promise<T>) => dbm.asUser(adminId, fn);

  /** Cloudinary stand-in: downloads serve bytes, uploads echo the id, destroys answer `destroy`. */
  const cloudinary = (opts: { destroy?: 'ok' | 'fail'; upload?: 'ok' | 'fail' } = {}) => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target.includes('/image/download')) {
        calls.push(`download ${new URL(target).searchParams.get('public_id')}`);
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 });
      }
      const form = init?.body as FormData;
      const id = String(form.get('public_id'));
      if (target.endsWith('/image/destroy')) {
        calls.push(`destroy ${id}`);
        return opts.destroy === 'fail' ? Response.json({ error: { message: 'down' } }, { status: 500 }) : Response.json({ result: 'ok' });
      }
      calls.push(`upload ${id}`);
      return opts.upload === 'fail' ? Response.json({ error: { message: 'down' } }, { status: 500 }) : Response.json({ public_id: id, bytes: 4 });
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  };

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', url!);
    vi.stubEnv('DATABASE_CA_CERT', '');
    vi.stubEnv('REVIEW_LINK_SECRET', 'integration-secret');
    vi.stubEnv('CLOUDINARY_URL', 'cloudinary://key:secret@testcloud');
    vi.stubEnv('RESEND_API_KEY', '');
    dbm = await import('../src/lib/server/db');
    store = await import('../src/lib/server/reviews/store');
    photos = await import('../src/lib/server/reviews/photos');
    link = await import('../src/lib/server/reviews/link');
    domain = await import('../src/lib/domain/reviews');
    const db = dbm.db();
    await db.run`insert into auth.users (id, name, email, email_verified, email_confirmed_at)
                 values (${adminId}, 'Boss', ${`boss.${adminId}@example.com`}, true, now())`;
    await db.run`insert into public.admin_users (user_id, email) values (${adminId}, ${`boss.${adminId}@example.com`})`;
    orderId = (await db.one<{ id: string }>`
      insert into public.orders (reference, locale, subtotal_cents, shipping_cents, total_cents, access_token_hash, payment_status, payment_provider, paid_at)
      values (${reference}, 'es', 1000, 0, 1000, 'x', 'paid', 'stripe', now()) returning id`)!.id;
    reviewId = (await db.one<{ id: string }>`
      insert into public.reviews (source, kind, author_name, body, locale, consent_at, order_id, status, verified)
      values ('customer', 'general', 'Ana G.', 'Preciosa', 'es', now() - interval '1 day', ${orderId}, 'pending', true) returning id`)!.id;
  });

  afterAll(async () => {
    if (dbm) {
      const db = dbm.db();
      await db.run`delete from public.reviews where order_id = ${orderId}`.catch(() => 0);
      await db.run`delete from public.orders where id = ${orderId}`.catch(() => 0);
      await db.run`delete from public.admin_audit_log where actor_user_id = ${adminId}`.catch(() => 0);
      await db.run`delete from public.admin_users where user_id = ${adminId}`.catch(() => 0);
      await db.run`delete from auth.users where id = ${adminId}`.catch(() => 0);
      await dbm.pool().end();
      delete (globalThis as { __pintoraPool?: unknown }).__pintoraPool;
    }
    vi.unstubAllEnvs();
  });

  it('customer edit → feature toggle refused (409) → publish with the old token refused; a fresh token works', async () => {
    const u0 = await updatedAt(); // what Meili's page loaded
    const input = domain.reviewInputSchema.parse({
      reference,
      key: link.reviewKey(orderId),
      body: 'Ahora digo otra cosa',
      authorName: 'Ana G.',
      locale: 'es',
      consent: true,
    });
    await store.submitCustomerReview(input, { ip: '203.0.113.9', db: dbm.db() });
    const u1 = await updatedAt();
    expect(u1).not.toBe(u0);

    await expect(asAdmin((tx) => store.updateReview(tx, reviewId, { featured: true }, u0))).rejects.toMatchObject({ status: 409 });
    const row = await dbm.db().one<{ featured: boolean; updated_at: string }>`select featured, updated_at from public.reviews where id = ${reviewId}`;
    expect(row).toEqual({ featured: false, updated_at: u1 });
    await expect(store.publishReview(dbm.db(), reviewId, u0)).rejects.toMatchObject({ status: 409 });
    expect((await dbm.db().one<{ status: string }>`select status from public.reviews where id = ${reviewId}`)!.status).toBe('pending');

    // Reloaded: the toggle answers the value its own write made, and that one publishes.
    const u2 = await asAdmin((tx) => store.updateReview(tx, reviewId, { featured: true }, u1));
    expect(u2).toBe(await updatedAt());
    expect(u2).not.toBe(u1);
    await store.publishReview(dbm.db(), reviewId, u2, { fetchImpl: cloudinary().fetchImpl });
    expect((await dbm.db().one<{ status: string; featured: boolean }>`select status, featured from public.reviews where id = ${reviewId}`)).toEqual({
      status: 'published',
      featured: true,
    });
  });

  it('a customer edit refreshes consent_at', async () => {
    const other = (await dbm.db().one<{ id: string }>`
      insert into public.orders (reference, locale, subtotal_cents, shipping_cents, total_cents, access_token_hash, payment_status, payment_provider, paid_at)
      values (${`${reference}-C`}, 'es', 1000, 0, 1000, 'x', 'paid', 'stripe', now()) returning id`)!.id;
    try {
      const id = (await dbm.db().one<{ id: string }>`
        insert into public.reviews (source, kind, author_name, body, locale, consent_at, order_id, status, verified)
        values ('customer', 'general', 'Ana G.', 'Preciosa', 'es', now() - interval '3 days', ${other}, 'pending', true) returning id`)!.id;
      const before = (await dbm.db().one<{ consent_at: string }>`select consent_at from public.reviews where id = ${id}`)!.consent_at;
      const input = domain.reviewInputSchema.parse({
        reference: `${reference}-C`,
        key: link.reviewKey(other),
        body: 'Cambiada',
        authorName: 'Ana G.',
        locale: 'es',
        consent: true,
      });
      await store.submitCustomerReview(input, { ip: '203.0.113.9', db: dbm.db() });
      const after = (await dbm.db().one<{ consent_at: string }>`select consent_at from public.reviews where id = ${id}`)!.consent_at;
      expect(Date.parse(after) - Date.parse(before)).toBeGreaterThan(2 * 86_400_000);
    } finally {
      await dbm.db().run`delete from public.reviews where order_id = ${other}`;
      await dbm.db().run`delete from public.orders where id = ${other}`;
    }
  });

  it('Meili drops one photo: both copies destroyed, row gone, updated_at moved; a mismatched pair is a 404', async () => {
    const photoId = (await dbm.db().one<{ id: string }>`
      insert into public.review_photos (review_id, position, private_public_id, public_public_id)
      values (${reviewId}, 0, ${`reviews-private/${reviewId}/x`}, ${`reviews/${reviewId}/x-1`}) returning id`)!.id;
    const before = await updatedAt();
    const cloud = cloudinary();
    await expect(photos.removeReviewPhotoAsAdmin(dbm.db(), orderId, photoId, { fetchImpl: cloud.fetchImpl })).rejects.toMatchObject({ status: 404 });
    expect(cloud.calls).toEqual([]);
    await photos.removeReviewPhotoAsAdmin(dbm.db(), reviewId, photoId, { fetchImpl: cloud.fetchImpl });
    expect(cloud.calls).toEqual([`destroy reviews/${reviewId}/x-1`, `destroy reviews-private/${reviewId}/x`]);
    expect(await dbm.db().one`select 1 as here from public.review_photos where id = ${photoId}`).toBeNull();
    expect(await updatedAt()).not.toBe(before);
  });

  it('hide with Cloudinary down: hidden at once, the public id kept; hiding again finishes', async () => {
    const photoId = (await dbm.db().one<{ id: string }>`
      insert into public.review_photos (review_id, position, private_public_id, public_public_id)
      values (${reviewId}, 0, ${`reviews-private/${reviewId}/h`}, ${`reviews/${reviewId}/h-1`}) returning id`)!.id;
    const down = await store.hideReview(dbm.db(), reviewId, { fetchImpl: cloudinary({ destroy: 'fail' }).fetchImpl });
    expect(down.warning).toBe(store.HIDE_LEFTOVER_WARNING);
    expect((await dbm.db().one<{ status: string }>`select status from public.reviews where id = ${reviewId}`)!.status).toBe('hidden');
    const kept = await dbm.db().one<{ public_public_id: string | null }>`select public_public_id from public.review_photos where id = ${photoId}`;
    expect(kept!.public_public_id).toBe(`reviews/${reviewId}/h-1`);
    // The admin page sees the leftover (and so keeps the Ocultar button).
    const seen = await store.getReview(dbm.db(), reviewId);
    expect(seen!.photos.find((p) => p.id === photoId)).toMatchObject({ publicCopy: true, url: null });
    expect(await store.hideReview(dbm.db(), reviewId, { fetchImpl: cloudinary().fetchImpl })).toEqual({});
    const gone = await dbm.db().one<{ public_public_id: string | null }>`select public_public_id from public.review_photos where id = ${photoId}`;
    expect(gone!.public_public_id).toBeNull();
  });

  it('publish names the copy on the row before uploading; a retry after a failed upload reuses that name', async () => {
    const before = (await dbm.db().rows<{ id: string; public_public_id: string | null }>`
      select id, public_public_id from public.review_photos where review_id = ${reviewId}`);
    expect(before.every((p) => p.public_public_id === null)).toBe(true);
    const failing = cloudinary({ upload: 'fail' });
    await expect(store.publishReview(dbm.db(), reviewId, await updatedAt(), { fetchImpl: failing.fetchImpl })).rejects.toBeTruthy();
    const named = (await dbm.db().rows<{ public_public_id: string }>`
      select public_public_id from public.review_photos where review_id = ${reviewId}`).map((p) => p.public_public_id);
    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(new RegExp(`^reviews/${reviewId}/[0-9a-f-]{36}-\\d{10}$`));
    expect(failing.calls.at(-1)).toBe(`upload ${named[0]}`);
    // Naming the copy is not a change to the review: the token Meili holds still publishes.
    const retry = cloudinary();
    await store.publishReview(dbm.db(), reviewId, await updatedAt(), { fetchImpl: retry.fetchImpl });
    expect(retry.calls.filter((c) => c.startsWith('upload'))).toEqual([`upload ${named[0]}`]);
    expect((await dbm.db().one<{ status: string }>`select status from public.reviews where id = ${reviewId}`)!.status).toBe('published');
  });

  it('delete with Cloudinary down leaves the review hidden with its photo row; a retry deletes it all', async () => {
    const down = store.deleteReview(dbm.db(), reviewId, { fetchImpl: cloudinary({ destroy: 'fail' }).fetchImpl });
    await expect(down).rejects.toMatchObject({ status: 502 });
    expect((await dbm.db().one<{ status: string }>`select status from public.reviews where id = ${reviewId}`)!.status).toBe('hidden');
    expect((await dbm.db().rows`select id from public.review_photos where review_id = ${reviewId}`).length).toBe(1);
    await store.deleteReview(dbm.db(), reviewId, { fetchImpl: cloudinary().fetchImpl });
    expect(await dbm.db().one`select 1 as here from public.reviews where id = ${reviewId}`).toBeNull();
  });

  it("the customer's removal locks the review, then deletes the row (transaction on the real pool)", async () => {
    const other = (await dbm.db().one<{ id: string }>`
      insert into public.orders (reference, locale, subtotal_cents, shipping_cents, total_cents, access_token_hash, payment_status, payment_provider, paid_at)
      values (${`${reference}-P`}, 'es', 1000, 0, 1000, 'x', 'paid', 'stripe', now()) returning id`)!.id;
    try {
      const id = (await dbm.db().one<{ id: string }>`
        insert into public.reviews (source, kind, author_name, body, locale, consent_at, order_id, status, verified)
        values ('customer', 'general', 'Ana G.', 'Preciosa', 'es', now(), ${other}, 'pending', true) returning id`)!.id;
      const photoId = (await dbm.db().one<{ id: string }>`
        insert into public.review_photos (review_id, position, private_public_id) values (${id}, 0, ${`reviews-private/${id}/c`}) returning id`)!.id;
      const cloud = cloudinary();
      await photos.removeReviewPhoto(dbm.db(), id, photoId, { fetchImpl: cloud.fetchImpl });
      expect(cloud.calls).toEqual([`destroy reviews-private/${id}/c`]);
      expect(await dbm.db().one`select 1 as here from public.review_photos where id = ${photoId}`).toBeNull();
    } finally {
      await dbm.db().run`delete from public.reviews where order_id = ${other}`;
      await dbm.db().run`delete from public.orders where id = ${other}`;
    }
  });
});
