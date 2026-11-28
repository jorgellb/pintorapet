import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb';

const gateDb = fakeDb({ query: () => ({ result: { verdict: 'allow', reasons: [] } }) });

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('../src/lib/server/db')>()),
  serviceDb: () => gateDb.db,
}));

const { inspect } = await import('../src/lib/server/antibot');

const formAsked = () => gateDb.queries.at(-1)?.values[0];

describe('inspect countAs', () => {
  it('counts an attempt under its own form by default', async () => {
    await inspect({ form: 'sign_in', fields: {}, ip: '203.0.113.9', email: 'a@x.com' });
    expect(formAsked()).toBe('sign_in');
  });

  it('can count it under another form’s limits (the token is still checked against its own form)', async () => {
    await inspect({ form: 'sign_in', countAs: 'forgot', fields: {}, ip: '203.0.113.9', email: 'a@x.com' });
    expect(formAsked()).toBe('forgot');
  });
});
