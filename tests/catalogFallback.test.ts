import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb';

const state = { database: true, fail: true };
const { db } = fakeDb({
  query: () => {
    if (state.fail) throw new Error('Connection terminated unexpectedly');
    return [];
  },
});
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  hasDatabase: () => state.database,
  anonDb: () => db,
}));

const { loadPublicCatalog } = await import('../src/lib/catalog/loadProducts');

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

const fallbackLogged = () =>
  (errors.mock.calls as unknown[][]).some(([line]) => typeof line === 'string' && line.startsWith('[catalog] FALLBACK'));

describe('the catalogue when the database cannot be read', () => {
  it('still shows the WooCommerce snapshot, and says so in the log', async () => {
    Object.assign(state, { database: true, fail: true });
    const catalog = await loadPublicCatalog('en');
    expect(catalog.source).toBe('migration');
    expect(catalog.products.length).toBeGreaterThan(0);
    expect(errors).toHaveBeenCalledWith('[catalog] database read failed:', 'Connection terminated unexpectedly');
    expect(fallbackLogged()).toBe(true);
  });

  it('logs nothing when the database answers', async () => {
    Object.assign(state, { database: true, fail: false });
    expect((await loadPublicCatalog('en')).source).toBe('supabase');
    expect(errors).not.toHaveBeenCalled();
  });

  it('logs nothing without a database, where the snapshot is expected', async () => {
    Object.assign(state, { database: false, fail: true });
    expect((await loadPublicCatalog('en')).source).toBe('migration');
    expect(fallbackLogged()).toBe(false);
  });
});
