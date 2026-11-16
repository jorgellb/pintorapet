import { describe, expect, it } from 'vitest';
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
});
