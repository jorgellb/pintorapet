import { CART_EVENT, readCart } from '@/stores/cart';
import {
  estimateShipping,
  readDestination,
  writeDestination,
  type Destination,
} from '@/stores/destination';
import {
  COUNTRIES_WITHOUT_POSTCODES,
  spanishProvince,
  suggestEmail,
} from '@/lib/domain/address';
import { isValidSpanishTaxId, normalizeTaxId } from '@/lib/domain/taxId';

const SAVED_KEY = 'petsdrawings.checkout.v1';
const ACCESS_KEY = 'petsdrawings.orderAccess.v1';

const SAVED_FIELDS = [
  'email',
  'phone',
  'name',
  'line1',
  'line2',
  'city',
  'state',
  'note',
  'taxId',
  'invoiceName',
  'invoiceAddress',
  'invoicePostal',
  'invoiceCity',
  'invoiceCountry',
] as const;

type Line = {
  productId: string;
  title: string;
  variantLabel: string | null;
  imageUrl: string | null;
  unitAmountCents: number;
};

type Quote = {
  quoteId: string | null;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  vatDiscountCents?: number;
  shipping?: { zoneName: string } | null;
};

type ApiError = { error?: { code?: string; message?: string } };

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function initCheckout(root: HTMLElement): void {
  const locale = root.dataset.locale === 'es' ? 'es' : 'en';
  const preview = root.dataset.preview === '1';
  const msg = (key: string) => root.dataset[key] ?? '';
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const money = new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  });
  const euros = (cents: number) => money.format(cents / 100);

  const form = root.querySelector<HTMLFormElement>('[data-checkout-form]')!;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const wrap = (name: string) => form.querySelector<HTMLElement>(`[data-field="${name}"]`);
  const value = (name: string) => (field(name)?.value ?? '').trim();
  const checked = (name: string) => (field(name) as HTMLInputElement | null)?.checked ?? false;

  const status = root.querySelector<HTMLElement>('[data-pay-status]')!;
  const shipLine = root.querySelector<HTMLElement>('[data-ship-line]')!;
  const parcel = root.querySelector<HTMLElement>('[data-parcel]')!;
  const route = root.querySelector<HTMLElement>('[data-route]')!;
  const payButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-pay]')];
  const invoiceBox = root.querySelector<HTMLElement>('[data-invoice]')!;
  const invoiceAddress = root.querySelector<HTMLElement>('[data-invoice-address]')!;
  const stateAuto = root.querySelector<HTMLElement>('[data-state-auto]')!;

  let quote: Quote | null = null;
  let shippingOk = false;
  let busy = false;
  const touched = new Set<string>();

  /* ——— Saved form and destination ——— */
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') as Record<string, string | boolean>;
    for (const name of SAVED_FIELDS) {
      if (typeof saved[name] === 'string' && field(name)) field(name).value = saved[name] as string;
    }
    (field('wantsInvoice') as HTMLInputElement).checked = saved.wantsInvoice === true;
    if (saved.invoiceSame === false) (field('invoiceSame') as HTMLInputElement).checked = false;
  } catch {
    // Nothing saved, or storage is blocked.
  }
  // Signed in: empty fields take the profile's details (what was typed here wins).
  try {
    const account = JSON.parse(root.dataset.account || 'null') as {
      email: string;
      name: string;
      phone: string;
      address: { line1: string; line2: string; city: string; state: string; postal_code: string; country: string } | null;
      billing: { taxId: string; name: string } | null;
    } | null;
    if (account) {
      const fill = (name: string, next: string | undefined) => {
        if (next && field(name) && !field(name).value) field(name).value = next;
      };
      fill('email', account.email);
      fill('name', account.name);
      fill('phone', account.phone);
      if (account.address) {
        fill('line1', account.address.line1);
        fill('line2', account.address.line2);
        fill('city', account.address.city);
        fill('state', account.address.state);
        if (!readDestination()) {
          writeDestination({ country: account.address.country, postalCode: account.address.postal_code });
        }
      }
      if (account.billing) {
        fill('taxId', account.billing.taxId);
        fill('invoiceName', account.billing.name);
      }
    }
  } catch {
    // Ignore a malformed profile.
  }
  const destination = readDestination();
  if (destination) {
    field('country').value = destination.country;
    field('postalCode').value = destination.postalCode;
  }
  if (!field('invoiceCountry').value) field('invoiceCountry').value = field('country').value;
  // A province that came from the postcode keeps following it after a reload.
  {
    const state = field('state') as HTMLInputElement;
    if (state.value && state.value === spanishProvince(field('postalCode').value)) state.dataset.auto = '1';
  }

  let saveTimer = 0;
  const save = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const data: Record<string, string | boolean> = {
        wantsInvoice: checked('wantsInvoice'),
        invoiceSame: checked('invoiceSame'),
      };
      for (const name of SAVED_FIELDS) data[name] = field(name)?.value ?? '';
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(data));
      } catch {
        // Private mode: the form only lasts for this visit.
      }
    }, 300);
  };

  /* ——— Validation ——— */
  const country = () => value('country').toUpperCase();
  const postalNeeded = () => country() === 'ES' || !COUNTRIES_WITHOUT_POSTCODES.includes(country());
  const wantsInvoice = () => checked('wantsInvoice');
  const separateInvoiceAddress = () => wantsInvoice() && !checked('invoiceSame');

  const rules: Record<string, () => boolean> = {
    email: () => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value('email')),
    phone: () => value('phone').replace(/\D/g, '').length >= 6,
    name: () => value('name').length >= 2,
    country: () => /^[A-Z]{2}$/.test(country()),
    postalCode: () =>
      country() === 'ES' ? /^\d{5}$/.test(value('postalCode')) : !postalNeeded() || value('postalCode').length > 0,
    line1: () => value('line1').length >= 3,
    city: () => value('city').length >= 2,
    taxId: () => {
      if (!wantsInvoice()) return true;
      const invoiceCountry = separateInvoiceAddress() ? value('invoiceCountry') : country();
      const id = normalizeTaxId(value('taxId'));
      return invoiceCountry === 'ES' ? isValidSpanishTaxId(id) : /^[A-Z0-9]{4,20}$/.test(id);
    },
    invoiceName: () => !wantsInvoice() || value('invoiceName').length >= 2,
    invoiceAddress: () => !separateInvoiceAddress() || value('invoiceAddress').length >= 3,
    invoicePostal: () => !separateInvoiceAddress() || value('invoicePostal').length > 0,
    invoiceCity: () => !separateInvoiceAddress() || value('invoiceCity').length >= 2,
  };

  const errorText: Record<string, () => string | null> = {
    postalCode: () => (country() === 'ES' && value('postalCode') ? msg('msgPostalEs') : msg('msgPostalMissing')),
    taxId: () =>
      (separateInvoiceAddress() ? value('invoiceCountry') : country()) === 'ES'
        ? msg('msgTaxEs')
        : msg('msgTaxForeign'),
  };

  const mark = (name: string, show = touched.has(name)) => {
    const box = wrap(name);
    const ok = rules[name]?.() ?? true;
    if (!box) return ok;
    const filled = (field(name)?.value ?? '').trim().length > 0;
    box.classList.toggle('is-invalid', show && !ok);
    box.classList.toggle('is-valid', ok && filled);
    field(name)?.setAttribute('aria-invalid', show && !ok ? 'true' : 'false');
    const err = box.querySelector<HTMLElement>('[data-err]');
    const text = errorText[name]?.();
    if (err && text) err.textContent = text;
    return ok;
  };

  /* ——— The label on the parcel writes itself ——— */
  const labelLine = (key: string, text: string) => {
    const el = parcel.querySelector<HTMLElement>(`[data-label="${key}"]`);
    if (!el) return;
    const next = text || el.dataset.placeholder || '';
    if (el.textContent === next) return;
    const wasWritten = el.classList.contains('is-written');
    el.textContent = next;
    el.classList.toggle('is-written', Boolean(text));
    if (text && !wasWritten) {
      el.classList.remove('is-fresh');
      void el.offsetWidth;
      el.classList.add('is-fresh');
    }
  };

  const paintLabel = () => {
    labelLine('name', value('name'));
    labelLine('street', [value('line1'), value('line2')].filter(Boolean).join(', '));
    labelLine('city', [value('postalCode'), value('city')].filter(Boolean).join(' '));
    const select = field('country') as HTMLSelectElement;
    labelLine('country', select.selectedOptions[0]?.textContent?.trim() ?? '');
  };

  /* ——— Progress along the route ——— */
  const contactDone = () => rules.email() && rules.phone();
  const addressDone = () =>
    ['name', 'country', 'postalCode', 'line1', 'city'].every((name) => rules[name]()) && shippingOk;

  const paintProgress = () => {
    const done = contactDone() ? (addressDone() ? 2 : 1) : 0;
    route.style.setProperty('--progress', String(done));
    route.querySelectorAll<HTMLElement>('[data-route-stop]').forEach((stop) => {
      const i = Number(stop.dataset.routeStop);
      stop.classList.toggle('is-done', i < done || (i === done && done === 2));
      stop.classList.toggle('is-current', i === done);
    });
    root.querySelector('[data-step="0"]')?.classList.toggle('is-complete', contactDone());
    root.querySelector('[data-step="1"]')?.classList.toggle('is-complete', addressDone());
  };

  /* ——— Province from the Spanish postcode ——— */
  const paintProvince = () => {
    const es = country() === 'ES';
    const state = field('state') as HTMLInputElement;
    const province = es ? spanishProvince(value('postalCode')) : null;
    if (province && (!state.value || state.dataset.auto === '1')) {
      state.value = province;
      state.dataset.auto = '1';
    } else if (!province && state.dataset.auto === '1') {
      state.value = '';
      delete state.dataset.auto;
    }
    stateAuto.hidden = !(province && state.dataset.auto === '1');
  };

  /* ——— Order lines ——— */
  let lines: Line[] = [];
  const renderLines = () => {
    const list = root.querySelector<HTMLElement>('[data-lines]')!;
    const items = readCart().items;
    const byId = new Map(lines.map((l) => [l.productId, l]));
    list.replaceChildren(
      ...items.map((item, i) => {
        const line = byId.get(item.productId);
        const li = document.createElement('li');
        li.style.animationDelay = `${i * 60}ms`;
        const img = document.createElement('span');
        img.className = 'line__img';
        if (line?.imageUrl) img.style.backgroundImage = `url("${line.imageUrl}")`;
        const qty = document.createElement('span');
        qty.className = 'line__qty';
        qty.textContent = String(item.quantity);
        img.append(qty);
        const title = document.createElement('span');
        title.className = 'line__title';
        title.textContent = line?.title ?? '…';
        if (line?.variantLabel) {
          const variant = document.createElement('span');
          variant.className = 'line__variant';
          variant.textContent = line.variantLabel;
          title.append(variant);
        }
        const price = document.createElement('span');
        price.className = 'line__price';
        price.textContent = line ? euros(line.unitAmountCents * item.quantity) : '';
        li.append(img, title, price);
        return li;
      }),
    );
    const stamp = root.querySelector<HTMLElement>('[data-parcel-stamp]');
    const first = lines.find((l) => l.imageUrl);
    if (stamp && first?.imageUrl) stamp.style.setProperty('--stamp', `url("${first.imageUrl}")`);
  };

  const sums = (key: string, text: string) => {
    const el = root.querySelector<HTMLElement>(`[data-sum="${key}"]`);
    if (el) el.textContent = text;
  };

  const paintSums = () => {
    const items = readCart().items;
    const byId = new Map(lines.map((l) => [l.productId, l]));
    const itemsCents = items.reduce(
      (sum, item) => sum + (byId.get(item.productId)?.unitAmountCents ?? 0) * item.quantity,
      0,
    );
    const discount = quote?.vatDiscountCents ?? 0;
    sums('subtotal', lines.length ? euros(quote ? quote.subtotalCents : itemsCents) : '—');
    if (quote && shippingOk) {
      sums('shipping', quote.shippingCents === 0 ? (locale === 'es' ? 'Gratis' : 'Free') : euros(quote.shippingCents));
      sums('zone', quote.shipping?.zoneName ? `· ${quote.shipping.zoneName}` : '');
      sums('total', euros(quote.totalCents));
      root.querySelector<HTMLElement>('[data-pay-total]')!.textContent = euros(quote.totalCents);
    } else {
      sums('total', lines.length ? euros(itemsCents) : '—');
      root.querySelector<HTMLElement>('[data-pay-total]')!.textContent = '—';
    }
    const vat = root.querySelector<HTMLElement>('[data-sum-vat]')!;
    vat.hidden = !(quote && discount > 0);
    if (discount > 0) sums('vat', `${euros(discount)} ${msg('msgVatTaken')}`);
  };

  const loadLines = async () => {
    const items = readCart().items;
    const empty = items.length === 0;
    root.querySelector<HTMLElement>('[data-empty]')!.hidden = !empty;
    form.querySelectorAll<HTMLElement>('.co-step').forEach((step) => (step.hidden = empty));
    root.querySelector<HTMLElement>('.co-aside')!.hidden = empty;
    route.hidden = empty;
    if (empty) return;
    try {
      const res = await fetch('/api/cart/lines/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ locale, ids: items.map((i) => i.productId) }),
      });
      lines = ((await res.json()) as { lines: Line[] }).lines ?? [];
    } catch {
      lines = [];
    }
    renderLines();
    paintSums();
  };

  /* ——— Shipping price and exact totals for the destination ——— */
  let destTimer = 0;
  let destSeq = 0;
  const refreshDestination = () => {
    window.clearTimeout(destTimer);
    destTimer = window.setTimeout(async () => {
      const seq = ++destSeq;
      const dest: Destination = { country: country(), postalCode: value('postalCode') };
      const items = readCart().items;
      const complete = /^[A-Z]{2}$/.test(dest.country) && (dest.country !== 'ES' || /^\d{5}$/.test(dest.postalCode));
      if (!complete || items.length === 0) {
        shippingOk = false;
        quote = null;
        shipLine.hidden = true;
        paintSums();
        paintProgress();
        return;
      }
      writeDestination(dest);
      shipLine.hidden = false;
      shipLine.classList.remove('is-error');
      shipLine.textContent = locale === 'es' ? 'Calculando el envío…' : 'Working out delivery…';
      try {
        const estimate = await estimateShipping(locale, items, dest);
        if (seq !== destSeq) return;
        if (!estimate.available) {
          shippingOk = false;
          quote = null;
          shipLine.classList.add('is-error');
          shipLine.textContent = msg('msgShipping');
        } else {
          const res = await fetch('/api/cart/quote/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              locale,
              items,
              shippingCountry: dest.country,
              shippingPostalCode: dest.postalCode || undefined,
            }),
          });
          const data = (await res.json()) as Quote & ApiError;
          if (seq !== destSeq) return;
          if (!res.ok) {
            shippingOk = false;
            quote = null;
            shipLine.classList.add('is-error');
            shipLine.textContent = String(data.error?.message ?? '').startsWith('SHIPPING_')
              ? msg('msgShipping')
              : msg('msgUnavailable');
          } else {
            shippingOk = true;
            quote = data;
            const price = estimate.shippingCents === 0 ? (locale === 'es' ? 'gratis' : 'free') : estimate.shippingFormatted;
            shipLine.replaceChildren(
              Object.assign(document.createElement('strong'), { textContent: estimate.zoneName }),
              document.createTextNode(estimate.delivery ? ` · ${estimate.delivery}` : ''),
              document.createTextNode(` · ${price}`),
            );
          }
        }
      } catch {
        if (seq !== destSeq) return;
        shippingOk = false;
        quote = null;
        shipLine.classList.add('is-error');
        shipLine.textContent = msg('msgError');
      }
      paintSums();
      paintProgress();
    }, 380);
  };

  /* ——— Email typo suggestion ——— */
  const suggestBox = root.querySelector<HTMLElement>('[data-email-suggest]')!;
  const paintSuggestion = () => {
    const suggestion = suggestEmail(value('email'));
    suggestBox.hidden = !suggestion;
    if (!suggestion) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = suggestion;
    button.addEventListener('click', () => {
      field('email').value = suggestion;
      suggestBox.hidden = true;
      touched.add('email');
      mark('email');
      paintProgress();
      save();
      field('phone').focus();
    });
    suggestBox.replaceChildren(document.createTextNode(`${msg('msgDidYouMean')} `), button, document.createTextNode('?'));
  };

  /* ——— Invoice block ——— */
  const paintInvoice = () => {
    invoiceBox.hidden = !wantsInvoice();
    invoiceAddress.hidden = !separateInvoiceAddress();
  };

  /* ——— Events ——— */
  form.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const name = target.name;
    if (name === 'state') delete target.dataset.auto;
    if (name === 'postalCode' || name === 'country') {
      paintProvince();
      refreshDestination();
    }
    if (name === 'taxId' || name === 'invoiceCountry') mark('taxId');
    if (rules[name]) mark(name);
    paintLabel();
    paintProgress();
    save();
  });

  form.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name === 'wantsInvoice' || target.name === 'invoiceSame') {
      paintInvoice();
      if (wantsInvoice() && target.name === 'wantsInvoice') field('taxId').focus();
    }
    if (target.name === 'country') {
      paintProvince();
      refreshDestination();
      if (touched.has('postalCode')) mark('postalCode');
    }
    save();
  });

  form.addEventListener(
    'blur',
    (event) => {
      const name = (event.target as HTMLInputElement).name;
      if (!name || !rules[name]) return;
      if ((field(name)?.value ?? '').trim() || touched.has(name)) touched.add(name);
      mark(name);
      if (name === 'email') paintSuggestion();
    },
    true,
  );

  window.addEventListener(CART_EVENT, () => {
    void loadLines();
    refreshDestination();
  });

  const say = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  };

  const setBusy = (on: boolean, provider?: string) => {
    busy = on;
    for (const button of payButtons) {
      button.disabled = on;
      button.setAttribute('aria-busy', on && button.dataset.pay === provider ? 'true' : 'false');
    }
  };

  const invoicePayload = () => {
    if (!wantsInvoice()) return undefined;
    const same = checked('invoiceSame');
    return {
      taxId: value('taxId'),
      name: value('invoiceName'),
      address: same ? [value('line1'), value('line2')].filter(Boolean).join(', ') : value('invoiceAddress'),
      postalCode: same ? value('postalCode') : value('invoicePostal'),
      city: same ? value('city') : value('invoiceCity'),
      country: same ? country() : value('invoiceCountry'),
    };
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const provider =
      ((event as SubmitEvent).submitter as HTMLButtonElement | null)?.value || payButtons[0]?.value || 'stripe';

    // Show every problem at once and take the visitor to the first one.
    const invalid = Object.keys(rules).filter((name) => {
      touched.add(name);
      return !mark(name, true);
    });
    if (invalid.length || !shippingOk) {
      say(invalid.length ? msg('msgFix') : msg('msgShipping'), true);
      const first = invalid[0] ? wrap(invalid[0]) : shipLine;
      first?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
      if (invalid[0]) {
        window.setTimeout(() => field(invalid[0])?.focus({ preventScroll: true }), calm ? 0 : 350);
        for (const name of invalid) {
          const box = wrap(name);
          box?.classList.remove('is-shaking');
          void box?.offsetWidth;
          box?.classList.add('is-shaking');
        }
      }
      return;
    }

    setBusy(true, provider);
    say(msg('msgBusy'));
    parcel.classList.add('is-sealed');
    const sealed = wait(calm ? 0 : 1100);

    try {
      const items = readCart().items;
      const quoteRes = await fetch('/api/cart/quote/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          locale,
          items,
          shippingCountry: country(),
          shippingPostalCode: value('postalCode') || undefined,
          invoice: invoicePayload(),
        }),
      });
      const fresh = (await quoteRes.json()) as Quote & ApiError;
      if (!quoteRes.ok || !fresh.quoteId) throw new Error(fresh.error?.message || 'quote');

      if (preview) {
        await sealed;
        say(locale === 'es'
          ? `Todo correcto (${euros(fresh.totalCents)}). En producción, aquí se abriría el pago.`
          : `All good (${euros(fresh.totalCents)}). In production, payment would open here.`);
        setBusy(false);
        return;
      }

      const createRes = await fetch('/api/checkout/create/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          provider,
          locale,
          quoteId: fresh.quoteId,
          attemptId: crypto.randomUUID(),
          items,
          saveToProfile: checked('saveToProfile') || undefined,
          customer: {
            email: value('email'),
            name: value('name'),
            phone: value('phone'),
            line1: value('line1'),
            line2: value('line2'),
            city: value('city'),
            state: value('state'),
            postalCode: value('postalCode'),
            country: country(),
            note: value('note'),
          },
        }),
      });
      const created = (await createRes.json()) as ApiError & {
        url?: string;
        reference?: string;
        accessToken?: string;
      };
      if (!createRes.ok || !created.url) throw new Error(created.error?.message || 'checkout');
      if (created.reference && created.accessToken) {
        try {
          sessionStorage.setItem(
            ACCESS_KEY,
            JSON.stringify({ reference: created.reference, accessToken: created.accessToken }),
          );
        } catch {
          // Ignore quota / private mode.
        }
      }
      await sealed;
      say(msg('msgSealed'));
      window.location.assign(created.url);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      parcel.classList.remove('is-sealed');
      setBusy(false);
      if (code === 'ADDRESS_DESTINATION_MISMATCH') say(msg('msgMismatch'), true);
      else if (code.startsWith('SHIPPING_')) say(msg('msgShipping'), true);
      else if (/UNAVAILABLE|NOT_FOUND|CART_/.test(code)) say(msg('msgUnavailable'), true);
      else if (code === 'Invalid quote payload') {
        touched.add('taxId');
        mark('taxId', true);
        say(msg('msgFix'), true);
      } else say(msg('msgError'), true);
    }
  });

  /* ——— First paint ——— */
  for (const name of Object.keys(rules)) {
    if ((field(name)?.value ?? '').trim()) touched.add(name);
    mark(name);
  }
  paintInvoice();
  paintProvince();
  paintLabel();
  paintProgress();
  void loadLines();
  refreshDestination();
}
