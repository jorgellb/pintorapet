"""Rebuild the catalog photos that only lived in Supabase Storage, from the
originals in public/media, with the exact recipes the 2026-11 imports used
(import_breeds.py, ornament_images.py, keyring_images.py; recovered from the
session log). Writes public/media/_regenerated/catalog/<object name>.

Run from the repo root: python3 <this file>
"""
import io
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:
    pass

MEDIA = Path('public/media')
OUT = MEDIA / '_regenerated' / 'catalog'


# --- import_breeds.py: cards, coasters, mugs --------------------------------
BREED_FILES = {
    'cockapoo': {
        'mugs': ['Cockapoo/taza/mockup taza.jpg', 'Cockapoo/taza/Untitled-1.jpg'],
        'coasters': ['Cockapoo/posavasos/Cockapoo coaster 2.jpg', 'Cockapoo/posavasos/cockapoo coaster 3.jpg'],
        'greeting-cards': [
            'Cockapoo/tarjetas/White Minimalist Paper Card Mockup Instagram Post copy 4.PNG',
            'Cockapoo/tarjetas/Neutral Simple Aesthetic Wedding Invitation Card Instagram Post 2 copy 2.PNG',
            'Cockapoo/tarjetas/White and Beige Minimalist Card Mockup Facebook Post 3 copy.PNG',
        ],
    },
    'french-bulldog': {
        'mugs': ['French Bulldog/Tazas/taza mockup.jpg', 'French Bulldog/Tazas/Untitled-1.jpg'],
        'coasters': ['French Bulldog/Posavasos/frenchie 2 copy.jpg', 'French Bulldog/Posavasos/frenchie 3 copy.jpg',
                     'French Bulldog/Posavasos/frenchi  1 copy.jpg'],
        'greeting-cards': [
            'French Bulldog/tarjetas/White Minimalist Paper Card Mockup Instagram Post 3 copy.PNG',
            'French Bulldog/tarjetas/Neutral Simple Aesthetic Wedding Invitation Card Instagram Post 2 copy 2.PNG',
            'French Bulldog/tarjetas/White and Beige Minimalist Card Mockup Facebook Post copy 2.PNG',
        ],
    },
    'pug': {
        'mugs': ['Pug/Taza/mockupod_0005_white-11oz-coffee-mug-mockup--boho-dreamy-podium (1) copy.jpg', 'Pug/Taza/Pug copy.jpg'],
        'coasters': ['Pug/Posavasos/Coasters PUg dog copy.jpg', 'Pug/Posavasos/Pug 2 copy.jpg', 'Pug/Posavasos/Pug coaster 1 copy.jpg'],
        'greeting-cards': [
            'Pug/Tarjetas/Pug card copy.jpg',
            'Pug/Tarjetas/Neutral Simple Aesthetic Wedding Invitation Card Instagram Post copy.png',
            'Pug/Tarjetas/White and Beige Minimalist Card Mockup Facebook Post copy.jpg',
        ],
    },
}


def optimise_breed(path: Path):
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        flat = Image.new('RGB', im.size, (255, 255, 255))
        flat.paste(im, mask=im.split()[-1])
        im = flat
    else:
        im = im.convert('RGB')
    im.thumbnail((1600, 1600), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=86, optimize=True, progressive=True)
    return out.getvalue(), im.width, im.height


# --- ornament_images.py (with the later centre_y edits) -----------------------
ORNAMENTS = {
    'pug': [('IMG_1533.jpg', 0.52)],
    'dachshund': [('IMG_1535.jpg', 0.47), ('IMG_1536.jpg', 0.40)],
    'labrador-retriever-black': [('IMG_1537.jpg', 0.53), ('IMG_1539.jpg', 0.40)],
    'border-collie': [('IMG_1540.jpg', 0.56), ('IMG_1541.jpg', 0.47)],
    'french-bulldog': [('IMG_1542.jpg', 0.53), ('IMG_1544.JPG', 0.47)],
    'jack-russell-terrier': [('IMG_4864.JPG', 0.47), ('IMG_4871.JPG', None)],
    'cockapoo': [('IMG_4867.JPG', 0.50), ('IMG_4869.JPG', 0.50), ('IMG_4866.JPG', None)],
    'springer-spaniel': [('IMG_4872.JPG', 0.50), ('IMG_4868.JPG', None)],
}


def render_ornament(name: str, centre_y, cover: bool):
    im = ImageOps.exif_transpose(Image.open(MEDIA / 'Navidad' / name)).convert('RGB')
    w, h = im.size
    if cover and centre_y is not None and h > w:
        top = int(min(max(centre_y * h - w / 2, 0), h - w))
        im = im.crop((0, top, w, top + w))
    im.thumbnail((1600, 1600), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=84, optimize=True, progressive=True)
    return out.getvalue(), im.width, im.height


# --- keyring_images.py --------------------------------------------------------
KEYRINGS = {
    'jack-russell-terrier': ('Jack rushell', ['Untitled-1.png', 'Gemini_Generated_Image_cqqoizcqqoizcqqo.jpg', 'Untitled-3.png', 'Untitled-2.png']),
    'border-collie': ('Border Collie', ['Border Collie.png', 'Gemini_Generated_Image_u6di0eu6di0eu6di.jpg', 'Untitled-2.png', 'Untitled-1.png']),
    'dachshund': ('Dachshund', ['Dachshund.png', 'Unknown.webp', 'Untitled-2.png', 'Untitled-1.png']),
    'golden-retriever': ('Golden Retriver', ['Golden Retriver.png', 'Gemini_Generated_Image_12ebtp12ebtp12eb.jpg', 'Untitled-2.png', 'Untitled-1.png']),
    'labrador-retriever-black': ('Black Lab', ['Black Labrador.png', 'Gemini_Generated_Image_nqm5cinqm5cinqm5.jpg', 'Untitled-2.png', 'Untitled-1.png']),
    'springer-spaniel': ('Springer spanial', ['Springer.png', 'Gemini_Generated_Image_i56ht8i56ht8i56h.jpg', 'Untitled-2.png', 'Untitled-1.png']),
    'cockapoo': ('Cockerpoo', ['Cockarpoo.png', 'Gemini_Generated_Image_zhprgzhprgzhprgz.jpg', 'Untitled-1.png', 'indivudual s.png']),
    'french-bulldog': ('French bulldog', ['French bulldog.png', 'Unknown copy.webp', 'Untitled-2.png', 'Untitled-1.png']),
    'pug': ('Pug', ['pug.png', 'Unknown copy 2.webp', 'Untitled-2.png', 'Untitled-1.png']),
}


def render_keyring(folder: str, name: str, cover: bool):
    im = ImageOps.exif_transpose(Image.open(MEDIA / 'Keyring' / folder / name)).convert('RGB')
    if cover and im.width != im.height:
        side = max(im.size)
        bg = im.getpixel((2, 2))
        square = Image.new('RGB', (side, side), bg)
        square.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
        im = square
    im.thumbnail((1600, 1600), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=86, optimize=True, progressive=True)
    return out.getvalue(), im.width, im.height


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for code, kinds in BREED_FILES.items():
        for kind, files in kinds.items():
            for i, rel in enumerate(files):
                jobs.append((f'{code}-{kind}-{i + 1}.jpg', lambda rel=rel: optimise_breed(MEDIA / rel)))
    for code, photos in ORNAMENTS.items():
        for i, (name, cy) in enumerate(photos):
            jobs.append((f'{code}-ornaments-{i + 1}.jpg', lambda name=name, cy=cy, i=i: render_ornament(name, cy, i == 0)))
    for code, (folder, files) in KEYRINGS.items():
        for i, name in enumerate(files):
            jobs.append((f'{code}-keyrings-{i + 1}.jpg', lambda folder=folder, name=name, i=i: render_keyring(folder, name, i == 0)))
    failed = []
    for out_name, make in jobs:
        try:
            data, w, h = make()
        except Exception as exc:  # report every missing original, not only the first
            failed.append(f'{out_name}: {exc}')
            continue
        (OUT / out_name).write_bytes(data)
    print(f'rendered {len(jobs) - len(failed)}/{len(jobs)} into {OUT}')
    for line in failed:
        print('  FAILED', line)


if __name__ == '__main__':
    main()
