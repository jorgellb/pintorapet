/**
 * Coupon links and the code kept in the browser.
 *
 * `?cupon=CODE` (or `?coupon=`) on any public page stores the code, takes the
 * parameter off the address and says so in a small note; the checkout applies
 * the stored code by itself. A code is not a secret, so it lives in
 * localStorage; every access is guarded because storage can be blocked.
 */

export const COUPON_STORAGE_KEY = 'petsdrawings.coupon.v1';
/** A stored code older than this is forgotten (a link from last season). */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** The shape coupons have in the database (the server judges the rest). */
const CODE_SHAPE = /^[A-Z0-9_-]{3,30}$/;

/** The code as typed: no spaces, upper-case. */
export const normalizeCode = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase();

export function readStoredCoupon(): string | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(COUPON_STORAGE_KEY) || 'null') as {
      code?: unknown;
      at?: unknown;
    } | null;
    if (!parsed || typeof parsed.code !== 'string' || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > KEEP_MS) return null;
    return CODE_SHAPE.test(parsed.code) ? parsed.code : null;
  } catch {
    return null;
  }
}

export function storeCoupon(code: string): void {
  try {
    localStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // Private mode: the code only lasts for this page.
  }
}

export function forgetCoupon(): void {
  try {
    localStorage.removeItem(COUPON_STORAGE_KEY);
  } catch {
    // Nothing to forget, or storage is blocked.
  }
}

const NOTE_TEXT = {
  es: (code: string) => `Cupón ${code} guardado: se aplica al pagar.`,
  en: (code: string) => `Coupon ${code} saved: it applies at checkout.`,
} as const;

function showNote(code: string, locale: 'es' | 'en'): void {
  const note = document.createElement('p');
  note.className = 'coupon-note';
  note.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = NOTE_TEXT[locale](code);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'coupon-note__close';
  close.setAttribute('aria-label', locale === 'es' ? 'Cerrar' : 'Close');
  close.textContent = '×';
  close.addEventListener('click', () => note.remove());
  note.append(text, close);
  document.body.append(note);
  window.setTimeout(() => note.remove(), 9000);
}

/** Read `?cupon=` once, store the code and tidy the address. */
export function initCouponLink(): void {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  const key = params.has('cupon') ? 'cupon' : params.has('coupon') ? 'coupon' : null;
  if (!key) return;
  const code = normalizeCode(params.get(key) ?? '');
  params.delete(key);
  const query = params.toString();
  try {
    history.replaceState(history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  } catch {
    // The address stays as it is.
  }
  if (!CODE_SHAPE.test(code)) return;
  storeCoupon(code);
  showNote(code, document.documentElement.lang === 'es' ? 'es' : 'en');
}
