import { waitForAntibot } from '@/scripts/antibot';
import { MAX_BYTES, photoPicker, resized } from '@/scripts/commissionPhotos';

/**
 * The customer's review form (src/views/ReviewPage.astro): the text goes first,
 * then the photos one by one, resized on the device like the commission form's.
 * The review is saved before its photos, so a photo that fails never loses the
 * words: the thank-you says which photos did not go and how to try again.
 */

type Labels = {
  sending: string;
  invalid: string;
  rate: string;
  closed: string;
  link: string;
  error: string;
  uploading: string;
  photoFailed: string;
  photoFailedMany: string;
  photoTooLarge: string;
  photoRemoveFailed: string;
  photoRemoved: string;
};

type ApiError = { error?: { code?: string; message?: string } };

export function reviewForm(form: HTMLFormElement) {
  const labels = JSON.parse(form.dataset.labels ?? '{}') as Labels;
  const reference = form.dataset.reference ?? '';
  const key = form.dataset.key ?? '';
  const fields = form.querySelector<HTMLElement>('[data-form-fields]')!;
  const done = form.querySelector<HTMLElement>('[data-form-done]')!;
  const status = form.querySelector<HTMLElement>('[data-form-status]')!;
  const progress = form.querySelector<HTMLProgressElement>('[data-photo-progress]')!;
  const failedBox = form.querySelector<HTMLElement>('[data-photo-failed]')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const body = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]')!;
  const count = form.querySelector<HTMLElement>('[data-count]');
  const sentList = form.querySelector<HTMLUListElement>('[data-sent-photos]');
  const pickerRoot = form.querySelector<HTMLElement>('[data-photo-picker]')!;
  const picker = photoPicker(pickerRoot);
  const totalRoom = Number(pickerRoot.dataset.total ?? 3);

  const say = (text: string, tone: 'info' | 'error' = 'info') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  // ——— Counter ———
  const showCount = () => {
    if (count) count.textContent = `${body.value.length} / ${body.maxLength}`;
  };
  body.addEventListener('input', showCount);
  showCount();

  // ——— Stars can be cleared ———
  const clear = form.querySelector<HTMLButtonElement>('[data-stars-clear]');
  const syncClear = () => {
    if (clear) clear.hidden = !form.querySelector('input[name="rating"]:checked');
  };
  form.addEventListener('change', syncClear);
  clear?.addEventListener('click', () => {
    form.querySelectorAll<HTMLInputElement>('input[name="rating"]').forEach((input) => (input.checked = false));
    syncClear();
    form.querySelector<HTMLInputElement>('input[name="rating"]')?.focus();
  });
  syncClear();

  // ——— Photos already sent: they can be taken off while the review is editable ———
  const roomLeft = () => totalRoom - (sentList?.querySelectorAll('li').length ?? 0);
  sentList?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-photo-remove]');
    const item = button?.closest('li');
    if (!button || !item) return;
    button.disabled = true;
    const res = await fetch('/api/reviews/photos/', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ r: reference, k: key, photoId: item.dataset.photoId }),
    }).catch(() => null);
    if (!res?.ok) {
      button.disabled = false;
      say(labels.photoRemoveFailed, 'error');
      return;
    }
    const next = item.nextElementSibling instanceof HTMLElement ? item.nextElementSibling : item.previousElementSibling;
    item.remove();
    picker.setMax(roomLeft());
    sentList.hidden = sentList.children.length === 0;
    say(labels.photoRemoved, 'info');
    (next?.querySelector<HTMLElement>('button') ?? form.querySelector<HTMLElement>('[data-photo-input]'))?.focus();
  });

  // ——— Sending ———
  const problem = (res: Response, payload: ApiError): string => {
    const message = payload.error?.message ?? '';
    if (res.status === 429 || payload.error?.code === 'RATE_LIMITED') return labels.rate;
    if (message === 'REVIEW_CLOSED') return labels.closed;
    if (message === 'REVIEW_LINK_INVALID') return labels.link;
    if (payload.error?.code === 'VALIDATION') return labels.invalid;
    return labels.error;
  };

  const uploadPhotos = async (): Promise<{ failed: number; tooLarge: number }> => {
    const files = picker.files();
    let failed = 0;
    let tooLarge = 0;
    progress.hidden = files.length === 0;
    progress.max = files.length;
    progress.value = 0;
    for (const [i, file] of files.entries()) {
      say(labels.uploading.replace('{n}', String(i + 1)).replace('{total}', String(files.length)));
      const blob = await resized(file);
      if (blob.size > MAX_BYTES) {
        failed += 1;
        tooLarge += 1;
        progress.value = i + 1;
        continue;
      }
      const data = new FormData();
      data.set('r', reference);
      data.set('k', key);
      data.set('file', blob, `foto-${i + 1}.jpg`);
      const res = await fetch('/api/reviews/photos/', { method: 'POST', body: data }).catch(() => null);
      if (!res?.ok) failed += 1;
      progress.value = i + 1;
    }
    progress.hidden = true;
    picker.clear();
    return { failed, tooLarge };
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    submit.setAttribute('aria-disabled', 'true');
    say(labels.sending);
    try {
      try {
        await waitForAntibot(form);
      } catch {
        // The anti-bot block shows its own message.
        say('');
        return;
      }
      const res = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      }).catch(() => null);
      if (!res) {
        say(labels.error, 'error');
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as ApiError;
      if (!res.ok) {
        say(problem(res, payload), 'error');
        return;
      }
      const { failed, tooLarge } = await uploadPhotos();
      if (failed > 0) {
        failedBox.hidden = false;
        failedBox.textContent = (failed === 1 ? labels.photoFailed : labels.photoFailedMany.replace('{n}', String(failed))) +
          (tooLarge > 0 ? ` ${labels.photoTooLarge}` : '');
      }
      say('');
      fields.hidden = true;
      done.hidden = false;
      done.querySelector<HTMLElement>('[tabindex="-1"]')?.focus();
    } catch {
      say(labels.error, 'error');
    } finally {
      delete form.dataset.busy;
      submit.removeAttribute('aria-disabled');
    }
  });

  // "Change it": the page is served again with what was saved.
  form.querySelector('[data-review-again]')?.addEventListener('click', () => location.reload());
}
