import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRON_AUDIENCE, forgetGithubKeys, GITHUB_ISSUER, isGithubCron } from '../src/lib/server/githubOidc';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const fetchKeys = vi.fn(async () => ({ keys: [jwk] }));

const NOW = Date.UTC(2026, 10, 28, 12);
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(overrides: Record<string, unknown> = {}, { key = privateKey, kid = 'k1' } = {}) {
  const claims = {
    iss: GITHUB_ISSUER,
    aud: CRON_AUDIENCE,
    repository: 'jorgellb/pintorapet',
    repository_id: '1431416576',
    repository_owner_id: '25139828',
    ref: 'refs/heads/main',
    workflow_ref: 'jorgellb/pintorapet/.github/workflows/outbox.yml@refs/heads/main',
    event_name: 'schedule',
    iat: NOW / 1000 - 10,
    nbf: NOW / 1000 - 10,
    exp: NOW / 1000 + 300,
    ...overrides,
  };
  const head = `${b64({ alg: 'RS256', typ: 'JWT', kid })}.${b64(claims)}`;
  return `Bearer ${head}.${sign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
}

const check = (authorization: string | null) => isGithubCron(authorization, { fetchKeys, now: NOW });

beforeEach(() => {
  forgetGithubKeys();
  fetchKeys.mockClear();
});

describe('GitHub-signed cron calls', () => {
  it('accepts the outbox workflow of this repository on main, on a schedule or by hand', async () => {
    expect(await check(token())).toBe(true);
    expect(await check(token({ event_name: 'workflow_dispatch' }))).toBe(true);
  });

  it('refuses another repository, branch, workflow, audience, event or an expired token', async () => {
    for (const overrides of [
      { repository: 'someone/pintorapet' },
      // The same name, re-created by someone else after a rename or a deleted account.
      { repository_id: '999' },
      { repository_owner_id: '999' },
      { ref: 'refs/heads/feature' },
      { workflow_ref: 'jorgellb/pintorapet/.github/workflows/ci.yml@refs/heads/main' },
      { aud: 'sts.amazonaws.com' },
      { event_name: 'pull_request' },
      { iss: 'https://evil.example' },
      { exp: NOW / 1000 - 1 },
      { nbf: NOW / 1000 + 600 },
    ]) {
      expect(await check(token(overrides)), JSON.stringify(overrides)).toBe(false);
    }
  });

  it('refuses a token not signed by GitHub, or tampered with', async () => {
    expect(await check(token({}, { key: other.privateKey }))).toBe(false);
    const [head, , sig] = token().slice(7).split('.');
    expect(await check(`Bearer ${head}.${b64({ repository: 'jorgellb/pintorapet' })}.${sig}`)).toBe(false);
    expect(await check(token({}, { kid: 'unknown' }))).toBe(false);
    expect(await check('Bearer not-a-jwt')).toBe(false);
    expect(await check(null)).toBe(false);
  });

  it("keeps GitHub's keys for an hour instead of fetching them on every call", async () => {
    await check(token());
    await check(token());
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it('asks GitHub at most once a minute, however many unknown key ids arrive at once', async () => {
    await Promise.all(Array.from({ length: 20 }, () => check(token({}, { kid: 'made-up' }))));
    await check(token({}, { kid: 'another' }));
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    // Still accepts the real key meanwhile.
    expect(await check(token())).toBe(true);
  });

  it('says no, and logs, when GitHub cannot be reached', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = vi.fn(async () => {
      throw new Error('timeout');
    });
    expect(await isGithubCron(token(), { fetchKeys: down, now: NOW })).toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
