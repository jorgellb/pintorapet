import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb';

const ADMIN = 'meili@petsdrawings.com';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'ana@x.com';

const stand = vi.hoisted(() => ({
  admins: new Set<string>(),
  verdict: 'allow' as 'allow' | 'block' | 'rate',
}));
const gate = vi.hoisted(() => ({ inspect: vi.fn(), reportSignedIn: vi.fn() }));
// Work left running after the answer (the link email), as Vercel would keep it.
const later = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('@vercel/functions', () => ({ waitUntil: (promise: Promise<unknown>) => void later.push(promise) }));
const settle = () => Promise.all(later.splice(0));
const api = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signInMagicLink: vi.fn(),
  signOut: vi.fn(),
  hash: vi.fn(),
}));

const owner = fakeDb({
  query: ({ text, values }) => {
    if (text.includes('auth.users')) return stand.admins.has(String(values[0])) ? { ok: 1 } : null;
    if (text.includes('admin_users')) return values[0] === ADMIN_ID && stand.admins.has(ADMIN) ? { ok: 1 } : null;
    return null;
  },
});

vi.mock('@/lib/server/auth', () => ({
  auth: () => ({
    api: { signInEmail: api.signInEmail, signInMagicLink: api.signInMagicLink, signOut: api.signOut },
    $context: Promise.resolve({ password: { hash: api.hash } }),
  }),
  hasAuth: () => true,
  sessionUser: vi.fn(async () => null),
}));
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('../src/lib/server/db')>()),
  db: () => owner.db,
  serviceDb: () => null,
}));
vi.mock('@/lib/server/antibot', async (original) => ({
  ...(await original<typeof import('../src/lib/server/antibot')>()),
  inspect: gate.inspect,
  reportSignedIn: gate.reportSignedIn,
}));

const { adminLogin, ADMIN_LOGIN_TEXT } = await import('../src/lib/server/adminLogin');

const cookies = { set: vi.fn() };
const post = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  form.set('_ab_token', 'token');
  return adminLogin(
    { cookies: cookies as never, request: new Request('http://x/admin/login/', { method: 'POST', headers: { 'x-real-ip': '203.0.113.9' } }) },
    form,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  stand.admins = new Set([ADMIN]);
  stand.verdict = 'allow';
  gate.inspect.mockImplementation(async () => ({ verdict: stand.verdict, score: 0, reasons: [] }));
  api.signInEmail.mockResolvedValue({
    headers: new Headers({ 'set-cookie': 'session=abc; Path=/; HttpOnly' }),
    response: { user: { id: ADMIN_ID } },
  });
  api.signInMagicLink.mockResolvedValue({ status: true });
  api.signOut.mockResolvedValue({ success: true });
});

describe('admin sign-in with a password', () => {
  it('signs an admin in, passes the session cookie on and tells the gate', async () => {
    expect(await post({ email: ADMIN, password: 'right-password' })).toEqual({ signedIn: true });
    expect(cookies.set).toHaveBeenCalledWith('session', 'abc', expect.anything());
    expect(gate.reportSignedIn).toHaveBeenCalledTimes(1);
  });

  it('goes through the sign-in gate (limits and anti-bot) first', async () => {
    await post({ email: ADMIN, password: 'x' });
    expect(gate.inspect).toHaveBeenCalledWith(expect.objectContaining({ form: 'sign_in', email: ADMIN, ip: '203.0.113.9' }));
    expect(gate.inspect.mock.calls[0][0].countAs).toBeUndefined();
  });

  it('answers a wrong admin password and a customer account the same, and never checks a customer password', async () => {
    api.signInEmail.mockRejectedValueOnce(new Error('INVALID_EMAIL_OR_PASSWORD'));
    const wrong = await post({ email: ADMIN, password: 'wrong' });
    api.signInEmail.mockClear();

    const customer = await post({ email: CUSTOMER, password: 'her-real-password' });
    expect(api.signInEmail).not.toHaveBeenCalled();
    // Same work as a password check, so the answer takes as long.
    expect(api.hash).toHaveBeenCalledWith('her-real-password');
    expect(customer).toEqual(wrong);
    expect(customer).toEqual({ signedIn: false, error: ADMIN_LOGIN_TEXT.failed });
    expect(cookies.set).not.toHaveBeenCalled();
  });

  it('ends the session at once when the account stopped being an admin meanwhile', async () => {
    api.signInEmail.mockResolvedValueOnce({
      headers: new Headers({ 'set-cookie': 'session=zzz; Path=/' }),
      response: { user: { id: '22222222-2222-4222-8222-222222222222' } },
    });
    expect(await post({ email: ADMIN, password: 'x' })).toEqual({ signedIn: false, error: ADMIN_LOGIN_TEXT.failed });
    expect(api.signOut).toHaveBeenCalledTimes(1);
    expect(cookies.set).not.toHaveBeenCalled();
  });

  it('stops after too many attempts, before any password is checked', async () => {
    stand.verdict = 'rate';
    expect(await post({ email: ADMIN, password: 'x' })).toEqual({ signedIn: false, error: ADMIN_LOGIN_TEXT.rate });
    expect(api.signInEmail).not.toHaveBeenCalled();
    expect(api.hash).not.toHaveBeenCalled();
  });

  it('gives a bot the wrong-password answer', async () => {
    stand.verdict = 'block';
    expect(await post({ email: ADMIN, password: 'x' })).toEqual({ signedIn: false, error: ADMIN_LOGIN_TEXT.failed });
    expect(api.signInEmail).not.toHaveBeenCalled();
  });

  it('a typo in the email does not count towards the limits', async () => {
    expect(await post({ email: 'not-an-email', password: 'x' })).toEqual({ signedIn: false, error: ADMIN_LOGIN_TEXT.email });
    expect(gate.inspect).not.toHaveBeenCalled();
  });
});

describe('admin sign-in link', () => {
  it('emails the link only to an admin, with the same notice for anyone', async () => {
    const admin = await post({ email: ADMIN, password: '' });
    await settle();
    expect(api.signInMagicLink).toHaveBeenCalledTimes(1);
    expect(api.signInMagicLink.mock.calls[0][0].body).toMatchObject({ email: ADMIN, callbackURL: '/admin/' });

    api.signInMagicLink.mockClear();
    const stranger = await post({ email: CUSTOMER, password: '' });
    await settle();
    expect(api.signInMagicLink).not.toHaveBeenCalled();
    expect(stranger).toEqual(admin);
    expect(stranger).toEqual({ signedIn: false, notice: ADMIN_LOGIN_TEXT.link });
  });

  it('answers without waiting for the email, so an admin’s address is not slower', async () => {
    api.signInMagicLink.mockReturnValueOnce(new Promise(() => {}));
    expect(await post({ email: ADMIN, password: '' })).toEqual({ signedIn: false, notice: ADMIN_LOGIN_TEXT.link });
    expect(later).toHaveLength(1);
    later.splice(0);
  });

  it('counts under the password-reset limits (a few emails per inbox an hour)', async () => {
    await post({ email: ADMIN, password: '' });
    expect(gate.inspect).toHaveBeenCalledWith(expect.objectContaining({ form: 'sign_in', countAs: 'forgot', email: ADMIN }));
  });

  it('sends nothing past the limit', async () => {
    stand.verdict = 'rate';
    expect(await post({ email: ADMIN, password: '' })).toEqual({ signedIn: false, error: ADMIN_LOGIN_TEXT.rate });
    await settle();
    expect(api.signInMagicLink).not.toHaveBeenCalled();
  });

  it('sends nothing to a bot, which still sees the notice', async () => {
    stand.verdict = 'block';
    expect(await post({ email: ADMIN, password: '' })).toEqual({ signedIn: false, notice: ADMIN_LOGIN_TEXT.link });
    await settle();
    expect(api.signInMagicLink).not.toHaveBeenCalled();
  });

  it('a link that could not be sent is logged, and the answer stays the same', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.signInMagicLink.mockRejectedValueOnce(new Error('resend down'));
    expect(await post({ email: ADMIN, password: '' })).toEqual({ signedIn: false, notice: ADMIN_LOGIN_TEXT.link });
    await settle();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
