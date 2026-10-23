import { emptyCart } from '@/lib/domain/cart';
import { writeCart } from '@/stores/cart';
import { readDestination } from '@/stores/destination';

const ACCESS_KEY = 'petsdrawings.orderAccess.v1';
const SAVED_FORM_KEY = 'petsdrawings.checkout.v1';

type Access = { reference: string; accessToken: string };

type Lookup = {
  reference: string;
  paymentStatus: string;
  customerEmail: string | null;
  customerName: string | null;
  shipping: { zoneName: string | null };
  totals: { subtotalCents: number; shippingCents: number; totalCents: number };
  items: Array<{ title: string; quantity: number; lineTotalCents: number }>;
};

type State = 'pending' | 'paid' | 'review' | 'failed' | 'slow' | 'unknown';

const PAID = ['paid', 'partially_refunded', 'refunded'];
const FAILED = ['expired', 'cancelled'];

function readAccess(): Access | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ACCESS_KEY) || 'null') as Access | null;
    return parsed?.reference && parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

/** The order is paid: the cart is done, and so is the note typed for this order. */
function forgetCheckout(): void {
  writeCart(emptyCart());
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_FORM_KEY) || '{}') as Record<string, unknown>;
    delete saved.note;
    localStorage.setItem(SAVED_FORM_KEY, JSON.stringify(saved));
  } catch {
    // Storage blocked: nothing to forget.
  }
}

export function initConfirmation(root: HTMLElement): void {
  const locale = root.dataset.locale === 'es' ? 'es' : 'en';
  const money = new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  });
  const euros = (cents: number) => money.format(cents / 100);

  const setState = (state: State) => {
    root.dataset.state = state;
  };

  const access = readAccess();
  const reference = access?.reference || root.dataset.ref || '';

  root.querySelectorAll<HTMLElement>('[data-ref-text]').forEach((el) => (el.textContent = reference));
  const statusLink = root.querySelector<HTMLAnchorElement>('[data-status-link]');
  if (statusLink && reference) {
    statusLink.href = `${root.dataset.statusHref}?ref=${encodeURIComponent(reference)}`;
  }

  // Where the parcel is going, from the checkout form kept in this browser.
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_FORM_KEY) || '{}') as { city?: string };
    const destination = readDestination();
    if (saved.city) root.querySelector('[data-home-city]')!.textContent = saved.city;
    if (destination?.country) {
      root.querySelector('[data-home-country]')!.textContent =
        new Intl.DisplayNames([locale], { type: 'region' }).of(destination.country) ?? destination.country;
    }
  } catch {
    // Keep the generic "your home".
  }

  if (!access) {
    setState('unknown');
    return;
  }

  const paint = (data: Lookup) => {
    const firstName = (data.customerName ?? '').trim().split(/\s+/)[0] ?? '';
    const title = root.querySelector<HTMLElement>('[data-paid-title]');
    if (title) {
      title.textContent = (root.dataset.paidTitle ?? '').replace('{name}', firstName ? `, ${firstName}` : '');
    }
    const lead = root.querySelector<HTMLElement>('[data-paid-lead]');
    if (lead) {
      lead.textContent = data.customerEmail
        ? (root.dataset.paidLead ?? '').replace('{email}', data.customerEmail)
        : (root.dataset.paidLeadNoEmail ?? '');
    }

    const list = root.querySelector<HTMLElement>('[data-receipt-lines]');
    list?.replaceChildren(
      ...data.items.map((item) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        const qty = document.createElement('span');
        qty.className = 'qty';
        qty.textContent = `${item.quantity} ×`;
        name.append(qty, document.createTextNode(item.title));
        const amount = document.createElement('span');
        amount.className = 'amount';
        amount.textContent = euros(item.lineTotalCents);
        li.append(name, amount);
        return li;
      }),
    );
    const set = (key: string, text: string) => {
      const el = root.querySelector<HTMLElement>(`[data-receipt="${key}"]`);
      if (el) el.textContent = text;
    };
    set('subtotal', euros(data.totals.subtotalCents));
    set('shipping', data.totals.shippingCents === 0 ? (locale === 'es' ? 'Gratis' : 'Free') : euros(data.totals.shippingCents));
    set('zone', data.shipping.zoneName ? `· ${data.shipping.zoneName}` : '');
    set('total', euros(data.totals.totalCents));
  };

  // The webhook usually confirms within seconds; ask again for about a minute and a half.
  setState('pending');
  const started = Date.now();
  let delay = 1500;

  const ask = async () => {
    try {
      const res = await fetch('/api/orders/lookup/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reference: access.reference, accessToken: access.accessToken, locale }),
      });
      if (res.ok) {
        const data = (await res.json()) as Lookup;
        if (PAID.includes(data.paymentStatus)) {
          paint(data);
          forgetCheckout();
          setState('paid');
          return;
        }
        if (data.paymentStatus === 'review') {
          paint(data);
          forgetCheckout();
          setState('review');
          return;
        }
        if (FAILED.includes(data.paymentStatus)) {
          setState('failed');
          return;
        }
      } else if (res.status === 404) {
        setState('unknown');
        return;
      }
    } catch {
      // Network hiccup: try again below.
    }
    if (Date.now() - started > 90_000) {
      setState('slow');
      return;
    }
    window.setTimeout(ask, delay);
    delay = Math.min(delay * 1.4, 6000);
  };

  void ask();
}
