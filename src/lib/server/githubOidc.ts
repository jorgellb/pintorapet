import { createPublicKey, verify, type KeyObject } from 'node:crypto';

/**
 * GitHub Actions' OpenID Connect tokens: a workflow run can ask GitHub for a
 * short-lived JWT naming its repository, branch and workflow, signed with
 * GitHub's keys. The site accepts one, instead of a shared secret, from the
 * outbox workflow of this repository on main (.github/workflows/outbox.yml).
 * Nothing needs to be copied into GitHub or Vercel for it.
 */
export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
export const CRON_AUDIENCE = 'petsdrawings-cron';
const REPOSITORY = 'jorgellb/pintorapet';
const WORKFLOW = `${REPOSITORY}/.github/workflows/outbox.yml@refs/heads/main`;
const EVENTS = new Set(['schedule', 'workflow_dispatch']);
const KEYS_TTL_MS = 60 * 60 * 1000;
/** An unknown key id refetches the key set, at most this often (key rotation). */
const REFETCH_MS = 60 * 1000;

type Jwk = { kid?: string; kty?: string; n?: string; e?: string };
type Keys = { at: number; byKid: Map<string, KeyObject> };

let cached: Keys | null = null;
let lastFetch = 0;

export type FetchKeys = () => Promise<{ keys: Jwk[] }>;

const fetchGithubKeys: FetchKeys = async () => {
  const res = await fetch(`${GITHUB_ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`GitHub keys answered ${res.status}`);
  return (await res.json()) as { keys: Jwk[] };
};

async function keyFor(kid: string, fetchKeys: FetchKeys, now: number): Promise<KeyObject | null> {
  const fresh = cached && now - cached.at < KEYS_TTL_MS;
  if (fresh && cached!.byKid.has(kid)) return cached!.byKid.get(kid)!;
  if (fresh && now - lastFetch < REFETCH_MS) return null;
  lastFetch = now;
  const { keys } = await fetchKeys();
  const byKid = new Map<string, KeyObject>();
  for (const jwk of keys ?? []) {
    if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
    byKid.set(jwk.kid, createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }));
  }
  cached = { at: now, byKid };
  return byKid.get(kid) ?? null;
}

/** For tests: forget the cached keys. */
export function forgetGithubKeys(): void {
  cached = null;
  lastFetch = 0;
}

const json = (part: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * True when `authorization` is `Bearer <GitHub OIDC token>` issued to the
 * outbox workflow of this repository on main, for this site, still valid.
 */
export async function isGithubCron(
  authorization: string | null,
  { fetchKeys = fetchGithubKeys, now = Date.now() }: { fetchKeys?: FetchKeys; now?: number } = {},
): Promise<boolean> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = json(headerPart);
  const claims = json(payloadPart);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return false;

  let key: KeyObject | null;
  try {
    key = await keyFor(header.kid, fetchKeys, now);
  } catch (err) {
    console.error('[cron] GitHub keys not read', err instanceof Error ? err.message : err);
    return false;
  }
  if (!key) return false;
  const signed = verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, 'base64url'));
  if (!signed) return false;

  const seconds = Math.floor(now / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return (
    claims.iss === GITHUB_ISSUER &&
    audiences.includes(CRON_AUDIENCE) &&
    claims.repository === REPOSITORY &&
    claims.ref === 'refs/heads/main' &&
    claims.workflow_ref === WORKFLOW &&
    EVENTS.has(String(claims.event_name)) &&
    typeof claims.exp === 'number' && claims.exp > seconds &&
    (typeof claims.nbf !== 'number' || claims.nbf <= seconds + 60)
  );
}
