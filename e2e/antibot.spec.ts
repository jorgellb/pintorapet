import { expect, test } from '@playwright/test';

/**
 * The anti-bot gate in a real browser. Nothing here creates accounts or sends
 * mail: people are shown to pass by the answer that comes after the gate
 * (wrong password, form not connected), bots by the fake success they get.
 */

test.describe('anti-bot gate', () => {
  test('a person signing in passes the gate', async ({ page }) => {
    await page.goto('/es/cuenta/entrar/');
    await page.getByLabel('Email').fill('nadie.antibot@example.com');
    await page.locator('input[name="password"]').fill('una-contraseña-mala');
    await page.getByRole('button', { name: 'Entrar' }).click();
    // Supabase answered, so the gate let the request through.
    await expect(page.getByRole('alert')).toContainText('no coinciden', { timeout: 20_000 });
  });

  test('a person writing to Meili sends a solved challenge', async ({ page }) => {
    // Caught before the server: the real endpoint would email Meili.
    let sent: URLSearchParams | null = null;
    let challengeAt = 0;
    page.on('response', (res) => {
      // The first one: after sending, the page already fetches the next.
      if (res.url().includes('/api/antibot/challenge/') && !challengeAt) challengeAt = Date.now();
    });
    await page.route('**/api/contact/', async (route) => {
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const field = (name: string) => body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1] ?? '';
      sent = new URLSearchParams({
        token: field('_ab_token'),
        pow: field('_ab_pow'),
        signals: field('_ab_i'),
        website: field('website'),
        at: String(Date.now()),
      });
      await route.fulfill({ json: { ok: true, id: 'test' } });
    });

    await page.goto('/es/contacto/');
    const form = page.locator('form[data-enhance]');
    await form.locator('input[name="name"]').pressSequentially('Ana García', { delay: 20 });
    await form.locator('input[name="email"]').pressSequentially('ana.garcia@example.com', { delay: 10 });
    await form.locator('textarea[name="message"]').fill('Hola, me gustaría un retrato de mi gata Luna.');
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('[data-form-done]')).toBeVisible({ timeout: 20_000 });

    const got = sent as URLSearchParams | null;
    expect(got?.get('token')).toMatch(/^v1\./);
    expect(got?.get('pow')).toMatch(/^\d+$/);
    expect(got?.get('website')).toBe('');
    expect(JSON.parse(got?.get('signals') || '{}').k).toBeGreaterThan(0);
    // The page waited the minimum time for this form (5 s) before sending.
    expect(Number(got?.get('at')) - challengeAt).toBeGreaterThanOrEqual(5000);
  });

  test('a scripted browser with a bot name gets a fake confirmation', async ({ page }) => {
    await page.goto('/es/cuenta/registro/');
    await page.locator('input[name="full_name"]').fill('NmtFTuFNRIWVBYtXtRibtonr');
    await page.locator('input[name="email"]').fill('w.o.qusow.ica.6.17@gmail.com');
    await page.locator('input[name="password"]').fill('contraseña-larga-1');
    await page.locator('input[name="privacy"]').check();
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    // Same screen a person sees, but no account was created (checked in SQL).
    await expect(page.getByText('Revisa tu correo')).toBeVisible({ timeout: 20_000 });
  });

  test('the honeypot is out of sight and out of the tab order', async ({ page }) => {
    await page.goto('/es/cuenta/registro/');
    const trap = page.locator('input[name="website"]');
    await expect(trap).toHaveAttribute('tabindex', '-1');
    const box = await trap.boundingBox();
    expect(box && box.x < 0).toBe(true);
  });

  test('posting without the challenge gets the fake answer', async ({ request }) => {
    const contact = await request.post('/api/contact/', {
      headers: { Accept: 'application/json' },
      form: { locale: 'es', name: 'Bot', email: 'bot@example.com', message: 'Buy backlinks' },
    });
    expect(contact.status()).toBe(200);
    expect(await contact.json()).toMatchObject({ ok: true });

    const commission = await request.post('/api/commissions/', {
      headers: { Accept: 'application/json' },
      form: { locale: 'es', name: 'Bot', email: 'bot@example.com', message: 'Hi', size: 'A4', subjects: '1' },
    });
    expect((await commission.json()).reference).toMatch(/^CR-[0-9A-F]{10}$/);

    const register = await request.post('/api/auth/register/', {
      form: { locale: 'es', full_name: 'Robot Uno', email: 'robot.uno@example.com', password: 'contraseña-larga-1', privacy: 'yes' },
      maxRedirects: 0,
    });
    expect(register.status()).toBe(303);
    expect(register.headers().location).toBe('/es/cuenta/registro/');
  });

  test('a challenge is good for one submission only (and needs Turnstile when on)', async ({ request }) => {
    const challenge = await (await request.get('/api/antibot/challenge/?form=sign_in')).json();
    expect(challenge.difficulty).toBeGreaterThanOrEqual(18);
    // Solve it here, as a determined bot would.
    const { createHash } = await import('node:crypto');
    let counter = 0;
    for (; ; counter += 1) {
      const digest = createHash('sha256').update(`${challenge.nonce}:${counter}`).digest();
      const zeros = digest.readUInt32BE(0) === 0 ? 32 : Math.clz32(digest.readUInt32BE(0));
      if (zeros >= challenge.difficulty) break;
    }
    const form = {
      locale: 'es',
      email: 'nadie.antibot@example.com',
      password: 'una-contraseña-mala',
      _ab_token: challenge.token,
      _ab_pow: String(counter),
      _ab_i: JSON.stringify({ k: 20, p: 2, w: false }),
    };
    const flash = async () => {
      const res = await request.post('/api/auth/sign-in/', { form, maxRedirects: 0 });
      const cookie = res.headers()['set-cookie'] ?? '';
      return decodeURIComponent(cookie);
    };
    if (challenge.turnstileSiteKey) {
      // With Turnstile on, solving the proof of work alone is not enough.
      expect(await flash()).toContain('generic');
      return;
    }
    expect(await flash()).toContain('credentials');
    expect(await flash()).toContain('generic');
  });

  test('the challenge endpoint is never cached and checks the form name', async ({ request }) => {
    const ok = await request.get('/api/antibot/challenge/?form=contact');
    expect(ok.headers()['cache-control']).toContain('no-store');
    expect((await request.get('/api/antibot/challenge/?form=admin')).status()).toBe(400);
  });
});
