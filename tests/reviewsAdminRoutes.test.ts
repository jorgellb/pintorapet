import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceError } from '../src/lib/server/commerce/errors';

const ID = '33333333-3333-4333-8333-333333333333';
const SEEN = '2026-11-26T10:00:00.123456+00:00';

const store = vi.hoisted(() => ({
  createAdminReview: vi.fn(),
  publishReview: vi.fn(),
  hideReview: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
  forgetReviews: vi.fn(),
}));
const audit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server/shipping/http', async (original) => ({
  ...(await original<typeof import('../src/lib/server/shipping/http')>()),
  audit,
}));
vi.mock('@/lib/server/reviews/store', () => store);
vi.mock('@/lib/server/adminAuth', () => ({ requireAdmin: async () => ({ user: { id: 'u1' }, db: { run: async () => 1 } }) }));
vi.mock('@/lib/server/db', () => ({
  asUser: async (_id: string, fn: (tx: unknown) => unknown) => fn({}),
  db: () => ({ run: async () => 1, one: async () => ({ updated_at: SEEN }) }),
}));

const index = await import('../src/pages/api/admin/reviews/index');
const byId = await import('../src/pages/api/admin/reviews/[id]');

const call = (handler: unknown, request: Request, params: Record<string, string> = {}) =>
  (handler as (c: unknown) => Promise<Response>)({ request, params, cookies: {} });
const post = (body: string, method = 'POST') => new Request('http://x/', { method, body, headers: { 'content-type': 'application/json' } });
const valid = { authorName: 'Lucía', body: 'Mensaje de Instagram', locale: 'es', publish: true };

beforeEach(() => {
  vi.clearAllMocks();
  store.createAdminReview.mockResolvedValue(ID);
  store.publishReview.mockResolvedValue(undefined);
  audit.mockResolvedValue(undefined);
});

describe('admin review routes', () => {
  it('a body that is not JSON is a 400 (create and change)', async () => {
    expect((await call(index.POST, post('{not json'))).status).toBe(400);
    expect((await call(byId.PATCH, post('{not json', 'PATCH'), { id: ID })).status).toBe(400);
    expect(store.createAdminReview).not.toHaveBeenCalled();
  });

  it('publishing needs the updated_at Meili saw', async () => {
    expect((await call(byId.PATCH, post(JSON.stringify({ action: 'publish' }), 'PATCH'), { id: ID })).status).toBe(400);
    expect((await call(byId.PATCH, post(JSON.stringify({ action: 'publish', updatedAt: 'ayer' }), 'PATCH'), { id: ID })).status).toBe(400);
    expect(store.publishReview).not.toHaveBeenCalled();
    const ok = await call(byId.PATCH, post(JSON.stringify({ action: 'publish', updatedAt: SEEN }), 'PATCH'), { id: ID });
    expect(ok.status).toBe(200);
    expect(store.publishReview).toHaveBeenCalledWith(expect.anything(), ID, SEEN);
  });

  it('a change (feature, save) must carry the updated_at the page saw', async () => {
    for (const body of [{ featured: true }, { featured: true, updatedAt: 'ayer' }, { city: 'Madrid' }]) {
      expect((await call(byId.PATCH, post(JSON.stringify(body), 'PATCH'), { id: ID })).status).toBe(400);
    }
    // Still strict: an unknown field is refused, token or not.
    expect((await call(byId.PATCH, post(JSON.stringify({ verified: true, updatedAt: SEEN }), 'PATCH'), { id: ID })).status).toBe(400);
    // The token alone is not a change.
    expect((await call(byId.PATCH, post(JSON.stringify({ updatedAt: SEEN }), 'PATCH'), { id: ID })).status).toBe(400);
    expect(store.updateReview).not.toHaveBeenCalled();
  });

  it('a guarded change answers the updated_at its own write made', async () => {
    const NEXT = '2026-11-26T10:05:00.654321+00:00';
    store.updateReview.mockResolvedValue(NEXT);
    const res = await call(byId.PATCH, post(JSON.stringify({ featured: true, updatedAt: SEEN }), 'PATCH'), { id: ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: ID, updatedAt: NEXT });
    expect(store.updateReview).toHaveBeenCalledWith(expect.anything(), ID, { featured: true }, SEEN);
    expect(audit).toHaveBeenCalledWith(expect.anything(), 'update_review', 'reviews', ID, { featured: true });
  });

  it('a toggle on a review that changed is a 409 with no new token, and changes nothing else', async () => {
    store.updateReview.mockRejectedValue(new CommerceError('CONFLICT', 'La opinión ha cambiado mientras la leías; vuelve a cargarla.', 409));
    const res = await call(byId.PATCH, post(JSON.stringify({ featured: true, updatedAt: SEEN }), 'PATCH'), { id: ID });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { updatedAt?: string; error: { message: string } };
    expect(body.updatedAt).toBeUndefined();
    expect(body.error.message).toBe('La opinión ha cambiado mientras la leías; vuelve a cargarla.');
    expect(store.forgetReviews).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('hide passes on the warning when photo copies are left in Cloudinary', async () => {
    store.hideReview.mockResolvedValue({ warning: 'Ocultada; quedan fotos por quitar de Cloudinary, vuelve a pulsar Ocultar' });
    const res = await call(byId.PATCH, post(JSON.stringify({ action: 'hide' }), 'PATCH'), { id: ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: ID, warning: 'Ocultada; quedan fotos por quitar de Cloudinary, vuelve a pulsar Ocultar' });
    store.hideReview.mockResolvedValue({});
    expect(await (await call(byId.PATCH, post(JSON.stringify({ action: 'hide' }), 'PATCH'), { id: ID })).json()).toEqual({ ok: true, id: ID });
  });

  it('a delete that Cloudinary stops answers the error saying the review is hidden', async () => {
    store.deleteReview.mockRejectedValue(new CommerceError('UNAVAILABLE', 'La opinión está oculta, pero no se pudieron borrar sus fotos de Cloudinary.', 502));
    const res = await call(byId.DELETE, new Request('http://x/', { method: 'DELETE' }), { id: ID });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('está oculta');
  });

  it('a review that changed while being read answers 409 with the reason', async () => {
    store.publishReview.mockRejectedValue(new CommerceError('CONFLICT', 'La opinión ha cambiado mientras la leías; vuelve a cargarla.', 409));
    const res = await call(byId.PATCH, post(JSON.stringify({ action: 'publish', updatedAt: SEEN }), 'PATCH'), { id: ID });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('ha cambiado');
  });

  it('saved but not published: the id comes back with the reason, not a save error', async () => {
    store.publishReview.mockRejectedValue(new CommerceError('UNAVAILABLE', 'Cloudinary no devolvió la foto.', 502));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call(index.POST, post(JSON.stringify(valid)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      id: ID,
      published: false,
      warning: 'Guardada, pero no se pudo publicar: Cloudinary no devolvió la foto.',
    });
    expect(store.createAdminReview).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('created and published', async () => {
    const res = await call(index.POST, post(JSON.stringify(valid)));
    expect(await res.json()).toEqual({ ok: true, id: ID, published: true });
    expect(store.publishReview).toHaveBeenCalledWith(expect.anything(), ID, SEEN);
  });

  it('an audit line that fails after a good publish does not say the publishing failed', async () => {
    audit.mockImplementation(async (_admin: unknown, operation: string) => {
      if (operation === 'publish_review') throw new Error('audit down');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call(index.POST, post(JSON.stringify(valid)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: ID, published: true });
    log.mockRestore();
  });
});
