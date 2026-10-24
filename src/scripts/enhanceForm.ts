import { waitForAntibot } from '@/scripts/antibot';

/**
 * Sends a form with fetch and shows the result in place, once the anti-bot
 * check is ready (see antibot.ts). Without JavaScript the form still posts and
 * the API redirects back with ?sent=1, but the anti-bot gate drops it: the
 * page says so in a <noscript> note.
 *
 * Markup contract:
 *   form[data-enhance] with data-msg-sending / -error / -invalid / -not-configured / -rate
 *   [data-form-fields]  the part hidden once sent
 *   [data-form-done]    the thank-you panel (hidden until sent)
 *   [data-form-status]  live region for progress and errors
 *   [data-form-reference] optional, filled with the reference returned by the API
 *   [data-form-reset]   optional button that brings the empty form back
 */
export function enhanceForm(form: HTMLFormElement): void {
  const fields = form.querySelector<HTMLElement>('[data-form-fields]');
  const done = form.querySelector<HTMLElement>('[data-form-done]');
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const message = (key: string) => form.dataset[key] ?? '';

  const setStatus = (text: string, tone: 'info' | 'error') => {
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const showDone = (reference?: string) => {
    const ref = form.querySelector<HTMLElement>('[data-form-reference]');
    if (ref && reference) {
      ref.textContent = reference;
      ref.closest<HTMLElement>('[data-form-reference-row]')?.removeAttribute('hidden');
    }
    if (fields) fields.hidden = true;
    if (done) {
      done.hidden = false;
      done.querySelector<HTMLElement>('[tabindex="-1"]')?.focus();
    }
    setStatus('', 'info');
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    submit?.setAttribute('aria-disabled', 'true');
    setStatus(message('msgSending'), 'info');

    try {
      try {
        await waitForAntibot(form);
      } catch {
        // The anti-bot block shows its own message.
        setStatus('', 'info');
        return;
      }
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        reference?: string;
        error?: { code?: string };
      };

      if (response.ok) {
        form.reset();
        form.dispatchEvent(new Event('input'));
        showDone(payload.reference);
        return;
      }

      const code = payload.error?.code;
      if (code === 'NOT_CONFIGURED') setStatus(message('msgNotConfigured'), 'error');
      else if (code === 'VALIDATION') setStatus(message('msgInvalid'), 'error');
      else if (code === 'RATE_LIMITED') setStatus(message('msgRate') || message('msgError'), 'error');
      else setStatus(message('msgError'), 'error');
    } catch {
      setStatus(message('msgError'), 'error');
    } finally {
      delete form.dataset.busy;
      submit?.removeAttribute('aria-disabled');
    }
  });

  form.querySelector('[data-form-reset]')?.addEventListener('click', () => {
    if (done) done.hidden = true;
    if (fields) fields.hidden = false;
    form.querySelector<HTMLElement>('input:not([type="hidden"]), textarea')?.focus();
  });
}
