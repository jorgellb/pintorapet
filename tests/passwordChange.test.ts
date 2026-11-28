import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.com', name: 'Ana' };

const stand = vi.hoisted(() => ({ hasPassword: true, verdict: 'allow' as 'allow' | 'block' | 'rate' }));
const fns = vi.hoisted(() => ({
  setOwnPassword: vi.fn(),
  inspect: vi.fn(),
  reportSignedIn: vi.fn(),
}));

vi.mock('@/lib/server/auth', async () => {
  class WrongCurrentPassword extends Error {}
  return {
    WrongCurrentPassword,
    auth: vi.fn(),
    hasAuth: () => true,
    sessionUser: async () => USER,
    hasOwnPassword: async () => stand.hasPassword,
    setOwnPassword: fns.setOwnPassword,
    signInWithPassword: vi.fn(),
  };
});
vi.mock('@/lib/server/antibot', async (original) => ({
  ...(await original<typeof import('../src/lib/server/antibot')>()),
  inspect: fns.inspect,
  reportSignedIn: fns.reportSignedIn,
}));

const { POST } = await import('../src/pages/api/auth/[action]');
const { WrongCurrentPassword } = await import('@/lib/server/auth');

type Answer = { location: string; flash: { error?: string } | null };

async function change(fields: Record<string, string>): Promise<Answer> {
  const form = new FormData();
  form.set('locale', 'en');
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  let flash: { error?: string } | null = null;
  const context = {
    params: { action: 'reset' },
    request: new Request('http://localhost/api/auth/reset/', { method: 'POST', body: form, headers: { 'x-real-ip': '203.0.113.7' } }),
    cookies: { set: (_name: string, value: string) => void (flash = JSON.parse(value)) },
    redirect: (location: string) => new Response(null, { status: 303, headers: { location } }),
  } as unknown as APIContext;
  const response = await POST(context);
  return { location: response.headers.get('location') ?? '', flash };
}

const NEW = { password: 'una-nueva-larga', password_repeat: 'una-nueva-larga' };

beforeEach(() => {
  vi.clearAllMocks();
  stand.hasPassword = true;
  stand.verdict = 'allow';
  fns.inspect.mockImplementation(async () => ({ verdict: stand.verdict, score: 0, reasons: [] }));
  fns.setOwnPassword.mockResolvedValue(undefined);
});

describe('changing the password from the account', () => {
  it('passes the current password on, and tells the gate when it worked', async () => {
    const answer = await change({ ...NEW, current_password: 'la-de-ahora' });
    expect(answer.location).toBe('/en/account/?password=1');
    expect(fns.setOwnPassword).toHaveBeenCalledWith(expect.anything(), expect.anything(), USER, 'una-nueva-larga', 'la-de-ahora');
    expect(fns.inspect).toHaveBeenCalledWith(expect.objectContaining({ form: 'sign_in', email: USER.email, ip: '203.0.113.7' }));
    expect(fns.reportSignedIn).toHaveBeenCalledTimes(1);
  });

  it('sends the visitor back when the current password is wrong', async () => {
    fns.setOwnPassword.mockRejectedValue(new WrongCurrentPassword());
    const answer = await change({ ...NEW, current_password: 'otra' });
    expect(answer.location).toBe('/en/account/new-password/');
    expect(answer.flash?.error).toBe('current');
    expect(fns.reportSignedIn).not.toHaveBeenCalled();
  });

  it('limits guesses of the current password like signing in', async () => {
    stand.verdict = 'rate';
    expect((await change({ ...NEW, current_password: 'otra' })).flash?.error).toBe('rate');
    stand.verdict = 'block';
    expect((await change({ ...NEW, current_password: 'otra' })).flash?.error).toBe('generic');
    expect(fns.setOwnPassword).not.toHaveBeenCalled();
  });

  it('lets an account made by link alone choose a first password without the gate', async () => {
    stand.hasPassword = false;
    const answer = await change(NEW);
    expect(answer.location).toBe('/en/account/?password=1');
    expect(fns.setOwnPassword).toHaveBeenCalledWith(expect.anything(), expect.anything(), USER, 'una-nueva-larga', '');
    expect(fns.inspect).not.toHaveBeenCalled();
  });

  it('checks typos before anything counts', async () => {
    const answer = await change({ password: 'una-nueva-larga', password_repeat: 'otra-distinta', current_password: 'x' });
    expect(answer.flash?.error).toBe('mismatch');
    expect(fns.inspect).not.toHaveBeenCalled();
  });
});
