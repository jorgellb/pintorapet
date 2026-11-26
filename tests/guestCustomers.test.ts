import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceError } from '../src/lib/server/commerce/errors';
import { mapPgError } from '../src/lib/server/commerce/pgErrors';
import { fakeDb } from './helpers/fakeDb';

const KEY = createHash('sha256').update('ana@x.com').digest('hex');
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const R1 = '44444444-4444-4444-8444-444444444441';
const R2 = '44444444-4444-4444-8444-444444444442';
const O1 = '55555555-5555-4555-8555-555555555551';

const reviews = vi.hoisted(() => ({ deleteReview: vi.fn(), forgetReviews: vi.fn() }));
const audit = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ admin: null as unknown, service: null as unknown, tx: null as unknown, log: [] as string[] }));

vi.mock('@/lib/server/reviews/store', () => reviews);
vi.mock('@/lib/server/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/server/adminAuth', () => ({ requireAdmin: async () => session.admin }));
vi.mock('@/lib/server/shipping/http', async (original) => ({
  ...(await original<typeof import('../src/lib/server/shipping/http')>()),
  audit,
}));
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('../src/lib/server/db')>()),
  db: () => ({ marker: 'owner' }),
  serviceDb: () => session.service,
  // Like PostgreSQL: committed when fn resolves, rolled back when it throws.
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    session.log.push('begin');
    try {
      const out = await fn(session.tx);
      session.log.push('commit');
      return out;
    } catch (err) {
      session.log.push('rollback');
      throw err;
    }
  },
}));

const customers = await import('../src/lib/server/admin/customers');
const { guestNotice } = await import('../src/lib/admin/guestNotice');
const guestRoute = await import('../src/pages/api/admin/customers/guest/[key]');
const accountRoute = await import('../src/pages/api/admin/customers/[id]/index');

const call = (handler: unknown, request: Request, params: Record<string, string>) =>
  (handler as (c: unknown) => Promise<Response>)({ request, params, cookies: {} });
const send = (method: string, body?: unknown) =>
  new Request('http://x/', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  session.admin = { user: { id: 'admin-1' }, db: { run: async () => 1 } };
  session.service = null;
  session.log = [];
  reviews.deleteReview.mockResolvedValue(undefined);
});

describe('guest key', () => {
  it('key is sha256 of lower(trim(email)), matching guest_key', () => {
    expect(customers.guestKey('ana@x.com')).toBe(KEY);
    expect(customers.guestKey('  Ana@X.com ')).toBe(KEY);
    expect(customers.guestKey('ana@x.com')).toMatch(/^[0-9a-f]{64}$/);
    expect(customers.guestKey('otra@x.com')).not.toBe(KEY);
  });
});

describe('anonymizing a guest', () => {
  const answer = (name: string) =>
    name === 'admin_guest_anonymize' ? { data: { orders: 2, review_ids: [R1, R2] } } : { data: null };

  it('anonymizeGuest deletes the returned reviews and forgets the cache', async () => {
    const { db, call: rpc } = fakeDb({ answer });
    const done = await customers.anonymizeGuest(db, KEY);
    expect(rpc).toHaveBeenCalledWith('admin_guest_anonymize', { p_key: KEY });
    expect(reviews.deleteReview).toHaveBeenCalledTimes(2);
    expect(reviews.deleteReview).toHaveBeenCalledWith({ marker: 'owner' }, R1);
    expect(reviews.deleteReview).toHaveBeenCalledWith({ marker: 'owner' }, R2);
    expect(reviews.forgetReviews).toHaveBeenCalled();
    expect(done).toEqual({ orders: 2 });
  });

  it('a Cloudinary failure after anonymizing is reported, data stays anonymized', async () => {
    reviews.deleteReview.mockRejectedValueOnce(new CommerceError('UNAVAILABLE', 'Cloudinary caído', 502));
    const { db, call: rpc } = fakeDb({ answer });
    const done = await customers.anonymizeGuest(db, KEY);
    // The data is gone and the call still answers; the other review is still deleted.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(done.orders).toBe(2);
    expect(done.warning).toMatch(/Cloudinary/);
    expect(done.warning).not.toMatch(/ana@/);
    expect(reviews.deleteReview).toHaveBeenCalledTimes(2);
    expect(reviews.forgetReviews).toHaveBeenCalled();
  });

  it('a review already gone is not a warning', async () => {
    reviews.deleteReview.mockRejectedValue(new CommerceError('UNAVAILABLE', 'No existe esa opinión.', 404));
    const { db } = fakeDb({ answer });
    expect(await customers.anonymizeGuest(db, KEY)).toEqual({ orders: 2 });
  });
});

describe('deleting an account together with its order data', () => {
  const setup = (anonymize: () => unknown) => {
    const { db, queries } = fakeDb({
      answer: (name) => {
        session.log.push(name);
        return name === 'admin_account_order_ids' ? { data: [O1] } : { data: null };
      },
      query: (q) => {
        if (q.text.includes('delete from auth.users')) session.log.push('delete_account');
        if (q.text.includes('from auth.users where id')) return { email: 'Ana@X.com' };
        if (q.text.includes('anonymize_orders')) {
          session.log.push('anonymize_orders');
          return anonymize();
        }
        return undefined;
      },
    });
    session.tx = db;
    return queries;
  };

  it('reads the order ids, deletes the account, anonymizes with its email: all in one transaction', async () => {
    const queries = setup(() => ({ result: { orders: 1, review_ids: [R1] } }));
    // The review photos (Cloudinary) are only touched once the database has committed.
    reviews.deleteReview.mockImplementation(async () => {
      session.log.push(`deleteReview after ${session.log.at(-1)}`);
    });
    const done = await customers.anonymizeAccountOrders(ACCOUNT);
    expect(session.log).toEqual([
      'begin',
      'admin_account_order_ids',
      'delete_account',
      'anonymize_orders',
      'commit',
      'deleteReview after commit',
    ]);
    expect(queries.find((q) => q.text.includes('anonymize_orders'))!.values).toEqual([[O1], 'Ana@X.com']);
    expect(reviews.deleteReview).toHaveBeenCalledWith({ marker: 'owner' }, R1);
    expect(done).toEqual({ orders: 1 });
  });

  it('account delete with alsoOrders: a due order rolls everything back with the 409, deleting no review', async () => {
    setup(() => {
      throw new Error('CUSTOMER_HAS_DUE_ORDERS: PP-0007, PP-0009');
    });
    const failure = await customers.anonymizeAccountOrders(ACCOUNT).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(CommerceError);
    expect((failure as CommerceError).status).toBe(409);
    expect((failure as CommerceError).message).toBe('Tiene pedidos pendientes de cobrar o de enviar: PP-0007, PP-0009');
    // The account was deleted inside the transaction, which then rolled back.
    expect(session.log).toEqual(['begin', 'admin_account_order_ids', 'delete_account', 'anonymize_orders', 'rollback']);
    expect(reviews.deleteReview).not.toHaveBeenCalled();
    expect(reviews.forgetReviews).not.toHaveBeenCalled();
  });

  it('a charged order with no invoice, or an unfinished checkout, also roll it back', async () => {
    for (const [code, text] of [
      ['CUSTOMER_HAS_UNINVOICED_ORDERS: PP-0011', 'sin factura emitida: emítela desde el pedido («Emitir ahora» en Factura) o con «Emitir facturas pendientes» en Ajustes antes de borrar: PP-0011'],
      ['CUSTOMER_HAS_UNFINISHED_ORDERS: PP-0012', 'sin terminar (PP-0012): bórralos en Pedidos'],
    ] as const) {
      session.log = [];
      setup(() => {
        throw new Error(code);
      });
      const failure = (await customers.anonymizeAccountOrders(ACCOUNT).catch((e: unknown) => e)) as CommerceError;
      expect(failure.status).toBe(409);
      expect(failure.message).toContain(text);
      expect(session.log.at(-1)).toBe('rollback');
    }
  });

  it('a Cloudinary failure after the commit is a warning: the account and its data stay deleted', async () => {
    setup(() => ({ result: { orders: 2, review_ids: [R1] } }));
    reviews.deleteReview.mockRejectedValueOnce(new CommerceError('UNAVAILABLE', 'Cloudinary caído', 502));
    const done = await customers.anonymizeAccountOrders(ACCOUNT);
    expect(session.log.at(-1)).toBe('commit');
    expect(done.orders).toBe(2);
    expect(done.warning).toMatch(/Cloudinary/);
  });
});

describe('error texts', () => {
  it('an email that belongs to an account is a 409 with its own text', () => {
    const err = mapPgError(new Error('GUEST_EMAIL_IS_ACCOUNT'));
    expect(err.status).toBe(409);
    expect(err.message).toBe('Ese email es de un cliente con cuenta: usa su ficha.');
  });

  it('due orders are a 409 that lists the references', () => {
    const err = mapPgError(new Error('CUSTOMER_HAS_DUE_ORDERS: PP-0001, PP-0002'));
    expect(err.status).toBe(409);
    expect(err.message).toBe('Tiene pedidos pendientes de cobrar o de enviar: PP-0001, PP-0002');
  });

  it('a charged order with no invoice says to issue it first', () => {
    const err = mapPgError(new Error('CUSTOMER_HAS_UNINVOICED_ORDERS: PP-0001, PP-0002'));
    expect(err.status).toBe(409);
    expect(err.message).toBe(
      'Tiene pedidos cobrados sin factura emitida: emítela desde el pedido («Emitir ahora» en Factura) o con «Emitir facturas pendientes» en Ajustes antes de borrar: PP-0001, PP-0002',
    );
  });

  it('an unfinished checkout says to delete it in Pedidos', () => {
    const err = mapPgError(new Error('CUSTOMER_HAS_UNFINISHED_ORDERS: PP-0003'));
    expect(err.status).toBe(409);
    expect(err.message).toBe('Tiene pedidos sin terminar (PP-0003): bórralos en Pedidos antes de borrar sus datos.');
  });

  it('a guest that no longer exists is a 404', () => {
    expect(mapPgError(new Error('GUEST_NOT_FOUND')).status).toBe(404);
  });
});

describe('the notice about Contacto and Encargos', () => {
  const tail = 'no se borran aquí. Por ahora no se pueden borrar desde Admin; si te lo piden, avísanos.';

  it('says nothing when there is nothing', () => {
    expect(guestNotice(0, 0)).toBeNull();
  });

  it('names both counts and says Admin cannot delete them', () => {
    expect(guestNotice(2, 1)).toBe(`Tiene 2 mensajes de Contacto y 1 encargo con este email: ${tail}`);
  });

  it('names only the one that exists', () => {
    expect(guestNotice(1, 0)).toBe(`Tiene 1 mensaje de Contacto con este email: ${tail}`);
    expect(guestNotice(0, 3)).toBe(`Tiene 3 encargos con este email: ${tail}`);
  });
});

describe('guest routes', () => {
  it('routes are admin-only and reject a bad key', async () => {
    const serviceCalls = vi.fn();
    session.service = fakeDb({ answer: (name) => (serviceCalls(name), { data: null }) }).db;

    session.admin = null;
    expect((await call(guestRoute.PATCH, send('PATCH', { full_name: 'Ana', email: 'a@x.com' }), { key: KEY })).status).toBe(403);
    expect((await call(guestRoute.DELETE, send('DELETE'), { key: KEY })).status).toBe(403);

    session.admin = { user: { id: 'admin-1' }, db: { run: async () => 1 } };
    for (const bad of ['abc', KEY.toUpperCase(), `${KEY}0`, 'ana@x.com', '']) {
      expect((await call(guestRoute.PATCH, send('PATCH', { full_name: 'Ana', email: 'a@x.com' }), { key: bad })).status).toBe(400);
      expect((await call(guestRoute.DELETE, send('DELETE'), { key: bad })).status).toBe(400);
    }
    expect(serviceCalls).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('the account route is admin-only too', async () => {
    session.admin = null;
    expect((await call(accountRoute.DELETE, send('DELETE', { alsoOrders: true }), { id: ACCOUNT })).status).toBe(403);
  });

  it('a delete records the count, never an email or a name', async () => {
    session.service = fakeDb({
      answer: (name) => (name === 'admin_guest_anonymize' ? { data: { orders: 3, review_ids: [] } } : { data: null }),
    }).db;
    const res = await call(guestRoute.DELETE, send('DELETE'), { key: KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orders: 3 });
    expect(audit).toHaveBeenCalledTimes(1);
    // The entity is the literal 'guest': neither an email, a name nor the key (a stable hash of an erased email).
    expect(audit.mock.calls[0]!.slice(1)).toEqual(['erase_guest_customer', 'guest_customers', 'guest', { orders: 3 }]);
    const line = JSON.stringify(audit.mock.calls[0]!.slice(1));
    expect(line).not.toMatch(/@|Ana/);
    expect(line).not.toContain(KEY);
    expect(line).not.toContain(KEY.slice(0, 12));
  });

  it('an edit that would merge two guests asks first, and goes through once confirmed', async () => {
    const answers: Record<string, unknown> = {
      admin_guest_customer: { key: 'x', orders: [{}, {}] },
      admin_guest_update: { key: 'k2', merged: true, orders: 2, phone_skipped: 1 },
    };
    const { db, call: rpc } = fakeDb({ answer: (name) => ({ data: answers[name] ?? null }) });
    session.service = db;
    const body = { full_name: 'Ana', email: 'otra@x.com', phone: '' };

    const asked = await call(guestRoute.PATCH, send('PATCH', body), { key: KEY });
    expect(asked.status).toBe(409);
    expect((await asked.json()).merge).toBe(true);
    expect(rpc).not.toHaveBeenCalledWith('admin_guest_update', expect.anything());

    const done = await call(guestRoute.PATCH, send('PATCH', { ...body, confirmMerge: true }), { key: KEY });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ ok: true, merged: true, orders: 2, key: 'k2', phoneSkipped: 1 });
    expect(audit.mock.calls[0]!.slice(1)).toEqual(['update_guest_customer', 'guest_customers', 'guest', { orders: 2, merged: true }]);
    expect(rpc).toHaveBeenCalledWith('admin_guest_update', {
      p_key: KEY,
      p_full_name: 'Ana',
      p_email: 'otra@x.com',
      p_phone: '',
    });
  });
});
