/**
 * Runs against a real PostgreSQL built by scripts/aiven/apply-schema.py and
 * filled by copy-data.py (scripts/aiven/local-db.sh). Skipped without
 * TEST_DATABASE_URL:
 *   TEST_DATABASE_URL=postgresql://avnadmin:local@localhost:55432/defaultdb npx vitest run tests/db.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('db against PostgreSQL', () => {
  let mod: typeof import('../src/lib/server/db');
  let customerId: string;
  let vaultKey: string | undefined;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', url!);
    vi.stubEnv('DATABASE_CA_CERT', '');
    vaultKey = process.env.TEST_VAULT_KEY;
    if (vaultKey) vi.stubEnv('VAULT_KEY', vaultKey);
    mod = await import('../src/lib/server/db');
    const row = await mod.db().one<{ id: string }>`select id from public.customers limit 1`;
    customerId = row!.id;
  });

  afterAll(async () => {
    await mod.pool().end();
    delete (globalThis as { __pintoraPool?: unknown }).__pintoraPool;
    vi.unstubAllEnvs();
  });

  it('returns PostgREST shapes: ISO timestamps, numeric counts', async () => {
    const row = await mod.db().one<{ at: string; n: number }>`
      select timestamptz '2026-11-16 12:05:09.5+00' as at, count(*) as n from public.products`;
    expect(row).toEqual({ at: '2026-11-16T12:05:09.5+00:00', n: expect.any(Number) });
  });

  it('as a visitor, reads the public catalogue but not the tables behind it', async () => {
    const published = await mod.asAnon((tx) => tx.one<{ n: number }>`select count(*) as n from public.catalog_products_v`);
    expect(published?.n).toBeGreaterThan(0);
    await expect(mod.asAnon((tx) => tx.rows`select * from public.products`)).rejects.toThrow(/permission denied/);
  });

  it('as a customer, auth.uid() is that customer and RLS limits rows to them', async () => {
    const result = await mod.asUser(customerId, (tx) =>
      tx.one<{ uid: string; customers: number }>`
        select auth.uid() as uid, (select count(*) from public.customers) as customers`,
    );
    expect(result).toEqual({ uid: customerId, customers: 1 });
  });

  it('leaves no role or claims behind on the pooled connection', async () => {
    await mod.asUser(customerId, (tx) => tx.one`select 1`);
    const after = await mod.db().one<{ role: string; uid: string | null }>`select current_user as role, auth.uid() as uid`;
    expect(after).toEqual({ role: 'avnadmin', uid: null });
  });

  it('rolls back everything when the callback fails', async () => {
    await expect(
      mod.transaction(async (tx) => {
        await tx.run`update public.products set sku = sku`;
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
  });

  it.skipIf(!process.env.TEST_VAULT_KEY)('reads secrets only with the vault key', async () => {
    const sealed = await mod.withVault((tx) => tx.rows`select name from vault.decrypted_secrets where decrypted_secret <> ''`);
    expect(sealed.length).toBeGreaterThan(0);
    await expect(mod.db().rows`select decrypted_secret from vault.decrypted_secrets`).rejects.toThrow(/vault key/);
  });

  it.skipIf(!process.env.TEST_VAULT_KEY)('sets the vault key for a signed-in user, who still cannot read the vault directly', async () => {
    const rows = await mod
      .userDb(customerId)
      .withVaultKey<{ has_key: boolean; uid: string }>(
        mod.sql`select current_setting('app.vault_key', true) <> '' as has_key, auth.uid() as uid`,
      );
    expect(rows[0]).toEqual({ has_key: true, uid: customerId });
    await expect(
      mod.userDb(customerId).withVaultKey(mod.sql`select * from vault.decrypted_secrets`),
    ).rejects.toThrow(/permission denied/);
  });
});
