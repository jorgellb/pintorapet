import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BLOCK_SCORE,
  canonicalEmail,
  combine,
  emailSignal,
  interactionSignal,
  leadingZeroBits,
  maskEmail,
  messageSignal,
  nameSignal,
  type Interaction,
  type Signal,
} from '@/lib/domain/antibot';
import { createServiceClient } from '@/lib/server/supabase';

/**
 * Anti-bot gate for the public forms, in layers:
 *   1. a signed, single-use challenge the page fetches when it loads;
 *   2. a proof of work the browser solves in the background (harder for IPs
 *      that were stopped recently);
 *   3. a honeypot field and a minimum time to fill the form;
 *   4. what the page saw: real key presses and taps, automated browsers;
 *   5. the content: random names, Gmail dot tricks, disposable inboxes, spam;
 *   6. rate limits per IP and per inbox, kept in the database (only solved
 *      attempts count, so nobody can lock someone else out; a busy site
 *      raises the difficulty instead of turning people away);
 *   7. Cloudflare Turnstile on top, when its keys are set.
 * Bots that fail get the same answer as a person, so they learn nothing.
 */

export type AntibotForm = 'register' | 'sign_in' | 'forgot' | 'contact' | 'commission';
export type Verdict = { verdict: 'allow' | 'block' | 'rate'; score: number; reasons: string[] };

/** Field names the gate adds to a form; strip them before validating the rest. */
export const ANTIBOT_FIELDS = ['website', '_ab_token', '_ab_pow', '_ab_i', 'cf-turnstile-response'] as const;

const FORMS: Record<AntibotForm, { minMs: number; expectTyping: boolean }> = {
  register: { minMs: 4000, expectTyping: true },
  // Password managers fill and send these in a blink.
  sign_in: { minMs: 0, expectTyping: false },
  forgot: { minMs: 1500, expectTyping: false },
  contact: { minMs: 5000, expectTyping: true },
  commission: { minMs: 6000, expectTyping: true },
};

const MAX_AGE_MS = 3 * 60 * 60 * 1000;
const BASE_DIFFICULTY = 18;
const HARD = 100;

export function isAntibotForm(value: string): value is AntibotForm {
  return value in FORMS;
}

let processSecret: string | null = null;

function key(): Buffer {
  const secret =
    import.meta.env.ANTIBOT_SECRET ||
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
    // Local development without keys: good for one process only.
    (processSecret ??= randomBytes(32).toString('hex'));
  return createHmac('sha256', String(secret)).update('pets-drawings antibot v1').digest();
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');

function sign(data: string): string {
  return createHmac('sha256', key()).update(data).digest('base64url');
}

/** Keyed hash: the same visitor matches across requests, the raw value is never stored. */
function hashOf(kind: 'ip' | 'email', value: string): string {
  return createHmac('sha256', key()).update(`${kind}:${value}`).digest('hex').slice(0, 40);
}

/** The visitor's IP as Vercel (or the dev server) reports it. Pass the Astro context. */
export function clientIp(context: { request: Request; clientAddress?: string }): string {
  const headers = context.request.headers;
  const forwarded =
    headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip') ?? headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim();
  if (first) return first.slice(0, 64);
  try {
    // Astro throws when the adapter cannot tell.
    return context.clientAddress || 'unknown';
  } catch {
    return 'unknown';
  }
}

type TokenPayload = { f: AntibotForm; t: number; n: string; d: number; ip: string };

export async function issueChallenge(form: AntibotForm, ip: string) {
  const ipHash = hashOf('ip', ip);
  let difficulty = BASE_DIFFICULTY;
  const service = createServiceClient();
  if (service) {
    const { data } = await service.rpc('antibot_pressure', { p_ip_hash: ipHash });
    const stopped = Number(data ?? 0);
    if (stopped >= 3) difficulty = BASE_DIFFICULTY + 4;
    else if (stopped >= 1) difficulty = BASE_DIFFICULTY + 2;
  }
  const payload: TokenPayload = { f: form, t: Date.now(), n: randomBytes(16).toString('base64url'), d: difficulty, ip: ipHash.slice(0, 12) };
  const body = b64(JSON.stringify(payload));
  return {
    token: `v1.${body}.${sign(body)}`,
    nonce: payload.n,
    difficulty,
    minMs: FORMS[form].minMs,
    turnstileSiteKey: turnstileConfigured() ? String(import.meta.env.PUBLIC_TURNSTILE_SITE_KEY) : null,
  };
}

function readToken(token: string): TokenPayload | null {
  const [version, body, signature] = token.split('.');
  if (version !== 'v1' || !body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.t !== 'number' || typeof payload.n !== 'string' || typeof payload.d !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

export function powValid(nonce: string, counter: string, difficulty: number): boolean {
  if (!/^\d{1,12}$/.test(counter)) return false;
  const digest = createHash('sha256').update(`${nonce}:${counter}`).digest();
  return leadingZeroBits(digest) >= difficulty;
}

function readInteraction(raw: unknown): Interaction | null {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      keys: Number(value.k) || 0,
      pointer: Number(value.p) || 0,
      webdriver: value.w === true,
    };
  } catch {
    return null;
  }
}

function turnstileConfigured(): boolean {
  return Boolean(import.meta.env.TURNSTILE_SECRET_KEY && import.meta.env.PUBLIC_TURNSTILE_SITE_KEY);
}

async function turnstileSignal(response: unknown, ip: string, form: AntibotForm): Promise<Signal> {
  if (!turnstileConfigured()) return { points: 0, reasons: [] };
  if (typeof response !== 'string' || !response) return { points: HARD, reasons: ['turnstile_missing'] };
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: String(import.meta.env.TURNSTILE_SECRET_KEY), response, remoteip: ip }),
      signal: AbortSignal.timeout(4000),
    });
    const data = (await res.json()) as { success?: boolean; action?: string };
    if (!data.success) return { points: HARD, reasons: ['turnstile'] };
    // A token solved on another form does not count here.
    if (data.action && data.action !== form) return { points: HARD, reasons: ['turnstile_action'] };
    return { points: 0, reasons: [] };
  } catch (err) {
    // Cloudflare unreachable: the other layers still stand.
    console.error('turnstile verify failed', err);
    return { points: 0, reasons: ['turnstile_unreachable'] };
  }
}

/** Check the anti-bot layers: the token, the proof of work, the timing and the visitor's signals. */
function challengeSignal(form: AntibotForm, fields: Record<string, unknown>, ipHash: string): { signal: Signal; nonce: string | null } {
  const hard = (reason: string) => ({ signal: { points: HARD, reasons: [reason] }, nonce: null });

  if (typeof fields.website === 'string' && fields.website.trim() !== '') return hard('honeypot');
  const token = typeof fields._ab_token === 'string' ? fields._ab_token : '';
  if (!token) return hard('token_missing');
  const payload = readToken(token);
  if (!payload) return hard('token_invalid');
  if (payload.f !== form) return hard('token_form');

  const age = Date.now() - payload.t;
  if (age > MAX_AGE_MS || age < -60_000) return { signal: { points: HARD, reasons: ['token_expired'] }, nonce: payload.n };
  if (age < FORMS[form].minMs) return { signal: { points: HARD, reasons: ['too_fast'] }, nonce: payload.n };

  const counter = typeof fields._ab_pow === 'string' ? fields._ab_pow : '';
  if (!powValid(payload.n, counter, payload.d)) {
    return { signal: { points: HARD, reasons: [counter ? 'pow_invalid' : 'pow_missing'] }, nonce: payload.n };
  }

  // Mobile networks change IPs; on its own this is not enough to stop anyone.
  const moved = payload.ip !== ipHash.slice(0, 12);
  return { signal: moved ? { points: 20, reasons: ['ip_changed'] } : { points: 0, reasons: [] }, nonce: payload.n };
}

export type Submission = {
  form: AntibotForm;
  /** Every posted field, including the ones the gate added */
  fields: Record<string, unknown>;
  ip: string;
  email?: string;
  name?: string;
  message?: string;
};

export async function inspect(submission: Submission): Promise<Verdict> {
  const { form, fields, ip } = submission;
  const ipHash = hashOf('ip', ip);
  const email = (submission.email ?? '').trim().toLowerCase();

  const { signal: challenge, nonce } = challengeSignal(form, fields, ipHash);
  const signals = combine(
    challenge,
    interactionSignal(readInteraction(fields._ab_i), { expectTyping: FORMS[form].expectTyping }),
    // Signing in only needs the challenge, the timing and the rate limits.
    form === 'sign_in' ? { points: 0, reasons: [] } : nameSignal(submission.name ?? ''),
    form === 'sign_in' ? { points: 0, reasons: [] } : emailSignal(email),
    messageSignal(submission.message ?? ''),
    challenge.points >= HARD ? { points: 0, reasons: [] } : await turnstileSignal(fields['cf-turnstile-response'], ip, form),
  );
  const score = Math.min(1000, signals.points);
  const local: Verdict = { verdict: score >= BLOCK_SCORE ? 'block' : 'allow', score, reasons: signals.reasons };

  const service = createServiceClient();
  if (!service) return local;
  const { data, error } = await service.rpc('antibot_gate', {
    p_form: form,
    p_ip_hash: ipHash,
    p_email_hash: email ? hashOf('email', canonicalEmail(email)) : null,
    p_email_hint: email ? maskEmail(email) : null,
    p_nonce: nonce,
    p_verdict: local.verdict,
    p_score: score,
    p_reasons: local.reasons,
  });
  if (error) {
    // Without the database there are no rate limits, but the rest still holds.
    console.error('antibot_gate failed', error.message);
    return local;
  }
  const gate = data as { verdict: Verdict['verdict']; reasons: string[] };
  return { verdict: gate.verdict, score, reasons: gate.reasons };
}

/** Tell the gate a sign-in worked: it never counts against the owner (see antibot_signed_in). */
export async function reportSignedIn(fields: Record<string, unknown>): Promise<void> {
  const payload = typeof fields._ab_token === 'string' ? readToken(fields._ab_token) : null;
  const service = createServiceClient();
  if (!payload || !service) return;
  const { error } = await service.rpc('antibot_signed_in', { p_nonce: payload.n });
  if (error) console.error('antibot_signed_in failed', error.message);
}

/** The posted fields without the ones the gate added, for strict schemas. */
export function withoutAntibotFields(raw: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...raw };
  for (const name of ANTIBOT_FIELDS) delete rest[name];
  return rest;
}

/** Form data as a plain record, for inspect(). */
export function formFields(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of form.entries()) if (typeof value === 'string') out[name] = value;
  return out;
}
