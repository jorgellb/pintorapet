/**
 * Sign-in against a real PostgreSQL (scripts/aiven/local-db.sh). Skipped
 * without TEST_DATABASE_URL:
 *   TEST_DATABASE_URL=postgresql://avnadmin:local@localhost:55432/defaultdb npx vitest run tests/auth.integration.test.ts
 */
import { randomUUID } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('passwords against PostgreSQL', () => {
  let dbMod: typeof import('../src/lib/server/db');
  let authMod: typeof import('../src/lib/server/auth');
  let passwordMod: typeof import('../src/lib/server/auth/password');
  const userIds: string[] = [];

  const cookies = () => ({ set: vi.fn() }) as unknown as AstroCookies;
  const request = () => new Request('http://localhost:4321/api/auth/sign-in/', { method: 'POST' });

  async function newUser(): Promise<{ id: string; email: string; name: string }> {
    const user = { id: randomUUID(), email: `password-test-${randomUUID()}@example.test`, name: 'Prueba' };
    await dbMod.db().run`
      INSERT INTO auth.users (id, email, name, email_verified) VALUES (${user.id}, ${user.email}, ${user.name}, true)`;
    userIds.push(user.id);
    return user;
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', url!);
    vi.stubEnv('DATABASE_CA_CERT', '');
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-for-integration-tests-only-0123456789');
    vi.stubEnv('SITE_URL', 'http://localhost:4321');
    dbMod = await import('../src/lib/server/db');
    authMod = await import('../src/lib/server/auth');
    passwordMod = await import('../src/lib/server/auth/password');
  });

  afterAll(async () => {
    for (const id of userIds) await dbMod.db().run`DELETE FROM auth.users WHERE id = ${id}`;
    await dbMod.pool().end();
    delete (globalThis as { __pintoraPool?: unknown }).__pintoraPool;
    vi.unstubAllEnvs();
  });

  it('checks a bcrypt hash like the ones Supabase stored', async () => {
    const row = await dbMod.db().one<{ hash: string }>`
      SELECT extensions.crypt('la-de-siempre', extensions.gen_salt('bf', 10)) AS hash`;
    const hash = row!.hash;
    expect(passwordMod.isSupabaseHash(hash)).toBe(true);
    expect(await passwordMod.verifyPassword({ hash, password: 'la-de-siempre' })).toBe(true);
    expect(await passwordMod.verifyPassword({ hash, password: 'otra-cualquiera' })).toBe(false);
  });

  it('signs in with a password brought over from Supabase', async () => {
    const user = await newUser();
    await dbMod.db().run`
      INSERT INTO auth.account (account_id, provider_id, user_id, password)
      VALUES (${user.id}, 'credential', ${user.id}, extensions.crypt('la-de-siempre', extensions.gen_salt('bf', 10)))`;
    const signedIn = await authMod.signInWithPassword(cookies(), request(), user.email, 'la-de-siempre');
    expect(signedIn.id).toBe(user.id);
    await expect(authMod.signInWithPassword(cookies(), request(), user.email, 'otra-cualquiera')).rejects.toThrow();
  });

  it('lets someone with no password yet choose one from their account', async () => {
    const user = await newUser();
    const jar = cookies();
    await authMod.setOwnPassword(jar, request(), user, 'una-nueva-larga');
    expect(jar.set).toHaveBeenCalled();
    const signedIn = await authMod.signInWithPassword(cookies(), request(), user.email, 'una-nueva-larga');
    expect(signedIn.id).toBe(user.id);
    const accounts = await dbMod.db().rows`SELECT 1 FROM auth.account WHERE user_id = ${user.id} AND provider_id = 'credential'`;
    expect(accounts).toHaveLength(1);
  });
});
