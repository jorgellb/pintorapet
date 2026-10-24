/**
 * Browser side of the anti-bot gate (see src/lib/server/antibot.ts). For every
 * [data-antibot] block inside a form it fetches a challenge, solves the proof
 * of work in small slices while the visitor types, and counts real key presses
 * and taps. Submitting waits until all of that is ready.
 *
 * Forms posted with fetch (enhanceForm) call waitForAntibot(form) first; plain
 * forms are held back and sent again with requestSubmit() once ready.
 */

type Challenge = {
  token: string;
  nonce: string;
  difficulty: number;
  minMs: number;
  turnstileSiteKey: string | null;
};

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
};

const READY = Symbol.for('pd.antibot');
const REFRESH_AFTER_MS = 60 * 60 * 1000;

type Protected = HTMLFormElement & { [READY]?: () => Promise<void> };

/** Resolves when the form can be sent; rejects when the challenge cannot be prepared. */
export function waitForAntibot(form: HTMLFormElement): Promise<void> {
  return (form as Protected)[READY]?.() ?? Promise.resolve();
}

// --- SHA-256, enough for one short ASCII message per call ------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);
const block = new Uint8Array(64);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** First 32 bits of SHA-256(message); the message must be under 56 ASCII bytes. */
function sha256Head(message: string): number {
  block.fill(0);
  for (let i = 0; i < message.length; i += 1) block[i] = message.charCodeAt(i);
  block[message.length] = 0x80;
  const bits = message.length * 8;
  block[62] = bits >>> 8;
  block[63] = bits & 0xff;
  for (let i = 0; i < 16; i += 1) {
    W[i] = (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
  }
  for (let i = 16; i < 64; i += 1) {
    const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
    const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = 0x6a09e667, b = 0xbb67ae85, c = 0x3c6ef372, d = 0xa54ff53a;
  let e = 0x510e527f, f = 0x9b05688c, g = 0x1f83d9ab, h = 0x5be0cd19;
  for (let i = 0; i < 64; i += 1) {
    const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  return (0x6a09e667 + a) >>> 0;
}

/** Find a counter whose hash starts with `difficulty` zero bits, yielding every few milliseconds. */
function solve(nonce: string, difficulty: number): Promise<string> {
  const limit = difficulty >= 32 ? 0 : 2 ** (32 - difficulty);
  return new Promise((resolve) => {
    let counter = 0;
    const step = () => {
      const until = performance.now() + 8;
      while (performance.now() < until) {
        for (let i = 0; i < 2000; i += 1, counter += 1) {
          if (sha256Head(`${nonce}:${counter}`) < limit) {
            resolve(String(counter));
            return;
          }
        }
      }
      setTimeout(step, 0);
    };
    step();
  });
}

// --- Cloudflare Turnstile (only when the site has its keys) ------------------

let turnstileScript: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    script.onerror = () => reject(new Error('turnstile'));
    document.head.append(script);
  });
  return turnstileScript;
}

// --- Wiring --------------------------------------------------------------------

function protect(root: HTMLElement): void {
  const form = root.closest('form') as Protected | null;
  if (!form || form[READY]) return;
  const kind = root.dataset.antibot ?? '';
  const status = root.querySelector<HTMLElement>('[data-antibot-status]');
  const field = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

  const counts = { k: 0, p: 0 };
  const count = (key: 'k' | 'p') => (event: Event) => {
    if (event.isTrusted) counts[key] += 1;
  };
  form.addEventListener('keydown', count('k'), { passive: true });
  form.addEventListener('input', count('k'), { passive: true });
  form.addEventListener('pointerdown', count('p'), { passive: true });
  form.addEventListener('touchstart', count('p'), { passive: true });

  let prepared: Promise<{ challenge: Challenge; fetchedAt: number; counter: string }> | null = null;
  let turnstile: { token: Promise<string>; renew: () => void } | null = null;

  const fetchChallenge = async (): Promise<Challenge> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const res = await fetch(`/api/antibot/challenge/?form=${encodeURIComponent(kind)}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (res.ok) return (await res.json()) as Challenge;
      } catch {
        /* retried below */
      }
      if (attempt >= 2) throw new Error('challenge');
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  };

  const setupTurnstile = async (siteKey: string) => {
    const api = await loadTurnstile();
    const box = root.querySelector<HTMLElement>('[data-antibot-turnstile]')!;
    box.hidden = false;
    let settle: (token: string) => void = () => {};
    const fresh = () => new Promise<string>((resolve) => (settle = resolve));
    let id = '';
    const state = {
      token: fresh(),
      // Turnstile tokens are single-use too.
      renew: () => {
        state.token = fresh();
        api.reset(id);
      },
    };
    id = api.render(box, {
      sitekey: siteKey,
      language: document.documentElement.lang || 'auto',
      callback: (token: string) => settle(token),
      'expired-callback': () => (state.token = fresh()),
    });
    turnstile = state;
  };

  const prepare = () => {
    prepared = (async () => {
      const challenge = await fetchChallenge();
      const fetchedAt = Date.now();
      if (challenge.turnstileSiteKey && !turnstile) void setupTurnstile(challenge.turnstileSiteKey);
      const counter = await solve(challenge.nonce, challenge.difficulty);
      return { challenge, fetchedAt, counter };
    })();
    // Keep a rejection from showing as unhandled; ready() reports it.
    prepared.catch(() => {});
  };

  const ready = async () => {
    if (!prepared) prepare();
    let current = await prepared!;
    if (Date.now() - current.fetchedAt > REFRESH_AFTER_MS) {
      prepare();
      current = await prepared!;
    }
    // A person can be quicker than the server expects (autofill): wait the rest.
    const wait = current.challenge.minMs + 250 - (Date.now() - current.fetchedAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (turnstile) await turnstile.token;

    field('_ab_token').value = current.challenge.token;
    field('_ab_pow').value = current.counter;
    field('_ab_i').value = JSON.stringify({ ...counts, w: navigator.webdriver === true });
    status?.setAttribute('hidden', '');

    // Each challenge is good for one submission: start the next one now.
    prepare();
    if (turnstile) {
      const state = turnstile;
      setTimeout(() => state.renew(), 0);
    }
  };

  form[READY] = () =>
    ready().catch((err) => {
      if (status) {
        status.textContent = root.dataset.msgError ?? '';
        status.hidden = false;
      }
      throw err;
    });

  // Plain forms: hold the first submit, send again once ready.
  if (!form.hasAttribute('data-enhance')) {
    let releasing = false;
    form.addEventListener('submit', (event) => {
      if (releasing) {
        releasing = false;
        return;
      }
      event.preventDefault();
      const submitter = (event as SubmitEvent).submitter as HTMLElement | null;
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      button?.setAttribute('aria-busy', 'true');
      form[READY]!()
        .then(() => {
          releasing = true;
          form.requestSubmit(submitter instanceof HTMLButtonElement ? submitter : undefined);
        })
        .catch(() => {})
        .finally(() => button?.removeAttribute('aria-busy'));
    });
  }

  // Start once the form is in view, or at the first interaction.
  const start = () => {
    if (!prepared) prepare();
  };
  form.addEventListener('focusin', start, { once: true });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    });
    observer.observe(form);
  } else {
    start();
  }
}

export function protectForms(): void {
  document.querySelectorAll<HTMLElement>('[data-antibot]').forEach(protect);
}
