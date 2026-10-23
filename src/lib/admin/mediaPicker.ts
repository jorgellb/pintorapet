export type PickedMedia = { id: string; url: string; name: string; altEs: string };

type PickOptions = {
  multiple?: boolean;
  exclude?: string[];
  bucket?: string;
};

type UploadResponse = {
  media?: { id: string; publicUrl: string; object_path: string; bucket: string; altEs: string };
  error?: { message?: string };
};

let wired = false;
let resolvePick: ((items: PickedMedia[]) => void) | null = null;
let options: PickOptions = {};
let bucket = '';
const selected = new Map<string, PickedMedia>();

const dialog = () => document.querySelector<HTMLDialogElement>('[data-media-picker]');
const tiles = () => [...document.querySelectorAll<HTMLElement>('[data-picker-item]')];

function fromTile(tile: HTMLElement): PickedMedia {
  return {
    id: tile.dataset.id ?? '',
    url: tile.dataset.url ?? '',
    name: tile.dataset.name ?? '',
    altEs: tile.dataset.alt ?? '',
  };
}

function refresh() {
  const root = dialog();
  if (!root) return;
  const query = root.querySelector<HTMLInputElement>('[data-picker-search]')?.value.trim().toLowerCase() ?? '';
  let shown = 0;
  for (const tile of tiles()) {
    const match =
      (!bucket || tile.dataset.bucket === bucket) &&
      (!query || (tile.dataset.searchText ?? '').includes(query));
    tile.hidden = !match;
    if (match) shown += 1;
    const button = tile.querySelector('button');
    const id = tile.dataset.id ?? '';
    if (button) {
      button.setAttribute('aria-pressed', String(selected.has(id)));
      button.disabled = (options.exclude ?? []).includes(id);
    }
  }
  root.querySelectorAll<HTMLAnchorElement>('[data-picker-bucket]').forEach((link) => {
    if (link.dataset.pickerBucket === bucket) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const empty = root.querySelector<HTMLElement>('[data-picker-empty]');
  if (empty) empty.hidden = shown > 0;
  const status = root.querySelector<HTMLElement>('[data-picker-status]');
  if (status) {
    status.textContent =
      selected.size === 0
        ? 'Ninguna seleccionada'
        : `${selected.size} ${selected.size === 1 ? 'seleccionada' : 'seleccionadas'}`;
  }
  const confirm = root.querySelector<HTMLButtonElement>('[data-picker-confirm]');
  if (confirm) confirm.disabled = selected.size === 0;
}

function toggle(tile: HTMLElement) {
  const item = fromTile(tile);
  if (selected.has(item.id)) {
    selected.delete(item.id);
  } else {
    if (!options.multiple) selected.clear();
    selected.set(item.id, item);
  }
  refresh();
}

function addTile(media: NonNullable<UploadResponse['media']>) {
  const grid = document.querySelector('[data-picker-grid]');
  const template = tiles()[0];
  if (!grid) return null;
  const name = media.object_path.split('/').pop() ?? media.object_path;
  const tile = document.createElement('li');
  if (template) {
    for (const attr of template.getAttributeNames()) {
      if (attr.startsWith('data-astro-cid')) tile.setAttribute(attr, '');
    }
  }
  tile.dataset.pickerItem = '';
  tile.dataset.id = media.id;
  tile.dataset.url = media.publicUrl;
  tile.dataset.name = name;
  tile.dataset.bucket = media.bucket;
  tile.dataset.alt = media.altEs ?? '';
  tile.dataset.searchText = name.toLowerCase();
  tile.innerHTML = template?.innerHTML ?? '<button type="button"><img alt="" /></button>';
  const img = tile.querySelector('img');
  if (img) img.src = media.publicUrl;
  const label = tile.querySelector('.picker__name');
  if (label) label.textContent = name;
  tile.querySelector('button')?.setAttribute('title', name);
  grid.prepend(tile);
  return tile;
}

async function upload(files: FileList) {
  const root = dialog();
  const status = root?.querySelector<HTMLElement>('[data-picker-status]');
  const target = bucket || options.bucket || root?.dataset.defaultBucket || 'catalog-public';
  let done = 0;
  for (const file of files) {
    if (status) status.textContent = `Subiendo ${done + 1} de ${files.length}…`;
    const body = new FormData();
    body.set('file', file);
    body.set('bucket', target);
    const response = await fetch('/api/admin/media/', { method: 'POST', body }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as UploadResponse | null;
    if (!response?.ok || !data?.media) {
      if (status) status.textContent = `No se pudo subir ${file.name}. ${data?.error?.message ?? ''}`;
      return;
    }
    const tile = addTile(data.media);
    if (tile) {
      if (!options.multiple) selected.clear();
      selected.set(data.media.id, fromTile(tile));
    }
    done += 1;
  }
  refresh();
}

function wire() {
  const root = dialog();
  if (!root || wired) return;
  wired = true;
  root.querySelector('[data-picker-grid]')?.addEventListener('click', (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>('[data-picker-item]');
    if (tile && !tile.querySelector('button')?.disabled) toggle(tile);
  });
  root.querySelectorAll<HTMLAnchorElement>('[data-picker-bucket]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      bucket = link.dataset.pickerBucket ?? '';
      refresh();
    });
  });
  root.querySelector('[data-picker-search]')?.addEventListener('input', refresh);
  root.querySelector<HTMLInputElement>('[data-picker-upload]')?.addEventListener('change', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.length) upload(input.files).finally(() => (input.value = ''));
  });
  root.querySelector('[data-picker-confirm]')?.addEventListener('click', () => {
    resolvePick?.([...selected.values()]);
    resolvePick = null;
    root.close();
  });
  root.addEventListener('close', () => {
    resolvePick?.([]);
    resolvePick = null;
  });
}

/** Opens the Medios dialog rendered by MediaPicker.astro and resolves with the chosen images. */
export function pickMedia(opts: PickOptions = {}): Promise<PickedMedia[]> {
  const root = dialog();
  if (!root) return Promise.resolve([]);
  wire();
  options = opts;
  bucket = opts.bucket ?? root.dataset.defaultBucket ?? '';
  selected.clear();
  refresh();
  root.showModal();
  return new Promise((resolve) => {
    resolvePick = resolve;
  });
}
