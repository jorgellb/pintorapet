/**
 * The pet's photos on the commission form: chosen (or dropped), shown as
 * thumbnails, resized on the device (2400 px JPEG) and uploaded one by one
 * once the form is sent, with the request's one-time key.
 */
const MAX_SIDE = 2400;
const MAX_BYTES = 4 * 1024 * 1024;

type Labels = {
  uploading: string;
  failed: string;
  tooMany: string;
  remove: string;
};

async function resized(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (blob) return blob;
  } catch {
    // A format the browser cannot open (HEIC on some phones): send it as it is.
  }
  return file;
}

export function photoPicker(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('[data-photo-input]')!;
  const list = root.querySelector<HTMLUListElement>('[data-photo-list]')!;
  const drop = root.querySelector<HTMLElement>('[data-photo-drop]')!;
  const note = root.querySelector<HTMLElement>('[data-photo-note]')!;
  const max = Number(root.dataset.max ?? 10);
  const labels = JSON.parse(root.dataset.labels ?? '{}') as Labels;
  let files: File[] = [];

  const render = () => {
    list.replaceChildren(
      ...files.map((file, i) => {
        const li = document.createElement('li');
        const img = document.createElement('img');
        img.alt = '';
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `${labels.remove} ${file.name}`);
        remove.addEventListener('click', () => {
          files.splice(i, 1);
          render();
        });
        li.append(img, remove);
        return li;
      }),
    );
    root.classList.toggle('has-photos', files.length > 0);
    drop.toggleAttribute('hidden', files.length >= max);
  };

  const add = (picked: FileList | File[]) => {
    const images = [...picked].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    const room = max - files.length;
    if (images.length > room) note.textContent = labels.tooMany.replace('{max}', String(max));
    else note.textContent = '';
    files = [...files, ...images.slice(0, Math.max(0, room))];
    render();
  };

  input.addEventListener('change', () => {
    if (input.files) add(input.files);
    input.value = '';
  });
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, () => drop.classList.remove('is-over'));
  }
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    if (event.dataTransfer?.files) add(event.dataTransfer.files);
  });

  return {
    /** Upload the photos for the request just sent; resolves with how many failed. */
    async upload(reference: string, token: string, say: (text: string) => void): Promise<number> {
      let failed = 0;
      for (const [i, file] of files.entries()) {
        say(labels.uploading.replace('{n}', String(i + 1)).replace('{total}', String(files.length)));
        const blob = await resized(file);
        if (blob.size > MAX_BYTES) {
          failed += 1;
          continue;
        }
        const body = new FormData();
        body.set('reference', reference);
        body.set('token', token);
        body.set('photo', blob, `foto-${i + 1}.jpg`);
        const res = await fetch('/api/commissions/photos/', { method: 'POST', body }).catch(() => null);
        if (!res?.ok) failed += 1;
      }
      files = [];
      render();
      return failed;
    },
  };
}
