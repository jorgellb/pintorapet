import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from 'better-auth/crypto';
import { isSupabaseHash, verifyPassword } from '../src/lib/server/auth/password';
import { fakeDb } from './helpers/fakeDb';

// The shape Supabase Auth stored: bcrypt, cost 10.
const SUPABASE_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

describe('isSupabaseHash', () => {
  it('tells the bcrypt hashes Supabase left apart from Better Auth scrypt ones', async () => {
    expect(isSupabaseHash(SUPABASE_HASH)).toBe(true);
    expect(isSupabaseHash(await hashPassword('una-contraseña'))).toBe(false);
    expect(isSupabaseHash('')).toBe(false);
    expect(isSupabaseHash('$2a$10$short')).toBe(false);
  });
});

describe('verifyPassword', () => {
  it('checks Better Auth hashes itself, without the database', async () => {
    const { db, queries } = fakeDb();
    const hash = await hashPassword('una-contraseña');
    expect(await verifyPassword({ hash, password: 'una-contraseña' }, () => db)).toBe(true);
    expect(await verifyPassword({ hash, password: 'otra' }, () => db)).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('asks PostgreSQL (pgcrypto) about a Supabase hash, passing the password as a parameter', async () => {
    const { db, queries } = fakeDb({ query: ({ values }) => ({ ok: values[0] === 'la-buena' }) });
    expect(await verifyPassword({ hash: SUPABASE_HASH, password: 'la-buena' }, () => db)).toBe(true);
    expect(await verifyPassword({ hash: SUPABASE_HASH, password: 'otra' }, () => db)).toBe(false);
    expect(queries[0].text).toMatch(/extensions\.crypt\(\$1, \$2\) = \$3/);
    expect(queries[0].text).not.toContain('la-buena');
    expect(queries[0].values).toEqual(['la-buena', SUPABASE_HASH, SUPABASE_HASH]);
  });

  it('stores a proved Supabase password again as scrypt, on that account only', async () => {
    const { db, queries } = fakeDb({ query: ({ text }) => (text.includes('crypt(') ? { ok: true } : 1) });
    expect(await verifyPassword({ hash: SUPABASE_HASH, password: 'la-buena' }, () => db)).toBe(true);
    expect(queries).toHaveLength(2);
    const update = queries[1]!;
    expect(update.text).toMatch(/UPDATE auth\.account SET password = \$1, updated_at = now\(\)\s+WHERE provider_id = 'credential' AND password = \$2/);
    const [scrypt, old] = update.values as [string, string];
    expect(old).toBe(SUPABASE_HASH);
    expect(isSupabaseHash(scrypt)).toBe(false);
    expect(await verifyPassword({ hash: scrypt, password: 'la-buena' }, () => db)).toBe(true);
    expect(await verifyPassword({ hash: scrypt, password: 'otra' }, () => db)).toBe(false);
  });

  it('leaves the hash alone when the password is wrong', async () => {
    const { db, queries } = fakeDb({ query: () => ({ ok: false }) });
    expect(await verifyPassword({ hash: SUPABASE_HASH, password: 'otra' }, () => db)).toBe(false);
    expect(queries).toHaveLength(1);
  });

  it('still signs in when the upgrade cannot be saved', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb({
      query: ({ text }) => {
        if (text.includes('crypt(')) return { ok: true };
        throw new Error('permission denied for table account');
      },
    });
    expect(await verifyPassword({ hash: SUPABASE_HASH, password: 'la-buena' }, () => db)).toBe(true);
    expect(errors).toHaveBeenCalledWith('[auth] could not upgrade a bcrypt password hash:', 'permission denied for table account');
    errors.mockRestore();
  });
});
