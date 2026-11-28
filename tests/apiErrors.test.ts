import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommerceError, internalError, jsonError } from '../src/lib/server/commerce/errors';
import { mapPgError } from '../src/lib/server/commerce/pgErrors';
import { checkoutCreateSchema } from '../src/lib/validation/checkout';

const PG_TEXT = 'invalid input syntax for type uuid: "x"';

afterEach(() => vi.restoreAllMocks());

describe('jsonError', () => {
  it('never sends what PostgreSQL said to the browser', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = jsonError(mapPgError(new Error(PG_TEXT)));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain('invalid input');
    expect(text).not.toContain('"pg"');
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL', message: 'Database commerce error' } });
  });

  it('keeps it out of mapped errors too (a unique index names the constraint)', async () => {
    const res = jsonError(mapPgError(new Error('duplicate key value violates unique constraint "coupons_code_unique"')));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body).toEqual({ error: { code: 'CONFLICT', message: 'Ya existe un cupón con ese código.' } });
  });

  it('drops validation issue trees', async () => {
    const issues = checkoutCreateSchema.safeParse({}).error;
    const body = await jsonError(new CommerceError('VALIDATION', 'Invalid checkout payload', 400, issues)).json();
    expect(body).toEqual({ error: { code: 'VALIDATION', message: 'Invalid checkout payload' } });
  });

  it('still hands the checkout the coupon sentence it shows', async () => {
    const err = new CommerceError('CONFLICT', 'COUPON_EXHAUSTED', 409, { couponMessage: 'Este cupón se ha agotado.' });
    const body = await jsonError(err).json();
    expect(body.error.details).toEqual({ couponMessage: 'Este cupón se ha agotado.' });
  });

  it('logs a server error with its detail, and not a customer mistake', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    jsonError(mapPgError(new Error('QUOTE_NOT_FOUND')));
    expect(log).not.toHaveBeenCalled();
    jsonError(mapPgError(new Error(PG_TEXT)));
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls[0])).toContain('invalid input syntax for type uuid');
  });
});

describe('internalError', () => {
  it('logs the cause once and answers a plain 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('connect ECONNREFUSED 10.0.0.7:5432');
    const res = internalError(cause, 'Quote failed');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Quote failed' } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toContain(cause);
  });
});

describe('checkoutCreateSchema', () => {
  it('takes only a real quote id, so a made-up one never reaches the database', () => {
    const base = { attemptId: '11111111-1111-4111-8111-111111111111', locale: 'es' };
    expect(checkoutCreateSchema.safeParse({ ...base, quoteId: 'x' }).success).toBe(false);
    expect(checkoutCreateSchema.safeParse({ ...base, quoteId: '22222222-2222-4222-8222-222222222222' }).success).toBe(true);
  });
});
