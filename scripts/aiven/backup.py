#!/usr/bin/env python3
"""Daily database backup (Aiven's free plan keeps none).

pg_dump (PostgreSQL 18, through Docker) → encrypted with gpg (AES-256, a
passphrase that never leaves the GitHub secrets) → Cloudinary as a *private*
raw file, readable only with a signed request. Keeps 35 days of dailies and,
forever, the one from the 1st of each month (invoices must be kept for years).

Environment: DATABASE_URL, DATABASE_CA_CERT (PEM), BACKUP_PASSPHRASE,
CLOUDINARY_URL. Standard library only, so it runs on a bare CI runner.

  python3 scripts/aiven/backup.py            # dump, upload, prune
  python3 scripts/aiven/backup.py --no-prune

Restore: download the file from Cloudinary (Media Library › backups, or a
signed URL), then
  gpg --decrypt db-YYYY-MM-DD.dump.gpg > db.dump
  pg_restore --no-owner --dbname "$DATABASE_URL" db.dump
"""
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
from base64 import b64encode
from pathlib import Path

PREFIX = 'backups/'
KEEP_DAYS = 35


def cloudinary() -> tuple[str, str, str]:
    m = re.fullmatch(r'cloudinary://([^:@/]+):([^@/]+)@([^/?#]+)', os.environ['CLOUDINARY_URL'].strip())
    if not m:
        raise SystemExit('CLOUDINARY_URL is not cloudinary://key:secret@cloud')
    return m.group(1), m.group(2), m.group(3)


def sign(params: dict, secret: str) -> str:
    payload = '&'.join(f'{k}={params[k]}' for k in sorted(params))
    return hashlib.sha1((payload + secret).encode()).hexdigest()


def dump(workdir: Path) -> Path:
    """pg_dump 18 in a container, so the client always matches the server."""
    ca = workdir / 'ca.pem'
    ca.write_text(os.environ['DATABASE_CA_CERT'])
    url = os.environ['DATABASE_URL']
    sep = '&' if '?' in url else '?'
    target = workdir / 'db.dump'
    subprocess.run(
        ['docker', 'run', '--rm', '--user', f'{os.getuid()}:{os.getgid()}', '-v', f'{workdir}:/work:Z',
         'postgres:18-alpine', 'pg_dump', f'{url}{sep}sslmode=verify-full&sslrootcert=/work/ca.pem',
         '--format=custom', '--no-owner', '--file=/work/db.dump'],
        check=True,
    )
    ca.unlink()
    if target.stat().st_size < 10_000:
        raise SystemExit(f'dump suspiciously small ({target.stat().st_size} bytes)')
    return target


def encrypt(path: Path) -> Path:
    out = path.with_suffix('.dump.gpg')
    subprocess.run(
        ['gpg', '--batch', '--yes', '--symmetric', '--cipher-algo', 'AES256', '--passphrase-fd', '0',
         '--output', str(out), str(path)],
        input=os.environ['BACKUP_PASSPHRASE'].encode(), check=True,
    )
    path.unlink()
    return out


def upload(path: Path, public_id: str) -> dict:
    key, secret, cloud = cloudinary()
    params = {'public_id': public_id, 'timestamp': int(time.time()), 'type': 'private', 'overwrite': 'true'}
    fields = {**params, 'api_key': key, 'signature': sign(params, secret)}
    boundary = uuid.uuid4().hex
    body = b''.join(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()
    )
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
             f'Content-Type: application/octet-stream\r\n\r\n').encode() + path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    request = urllib.request.Request(f'https://api.cloudinary.com/v1_1/{cloud}/raw/upload', data=body,
                                     headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def admin(method: str, path: str, query: dict) -> dict:
    key, secret, cloud = cloudinary()
    auth = b64encode(f'{key}:{secret}'.encode()).decode()
    request = urllib.request.Request(
        f'https://api.cloudinary.com/v1_1/{cloud}/{path}?{urllib.parse.urlencode(query, doseq=True)}',
        method=method, headers={'Authorization': f'Basic {auth}'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def prune(today: dt.date) -> list[str]:
    """Dailies older than KEEP_DAYS go; the 1st of each month stays."""
    names = []
    cursor = None
    while True:
        query = {'prefix': PREFIX, 'max_results': 500, **({'next_cursor': cursor} if cursor else {})}
        page = admin('GET', 'resources/raw/private', query)
        names += [r['public_id'] for r in page.get('resources', [])]
        cursor = page.get('next_cursor')
        if not cursor:
            break
    stale = []
    for name in names:
        m = re.search(r'db-(\d{4})-(\d{2})-(\d{2})', name)
        if not m:
            continue
        day = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if day.day != 1 and (today - day).days > KEEP_DAYS:
            stale.append(name)
    for start in range(0, len(stale), 100):
        admin('DELETE', 'resources/raw/private', {'public_ids[]': stale[start:start + 100]})
    return stale


def main() -> None:
    today = dt.datetime.now(dt.timezone.utc).date()
    with tempfile.TemporaryDirectory() as tmp:
        encrypted = encrypt(dump(Path(tmp)))
        size = encrypted.stat().st_size
        result = upload(encrypted, f'{PREFIX}db-{today.isoformat()}.dump.gpg')
    print(f'backup uploaded: {result["public_id"]} ({size // 1024} KB, private)')
    if '--no-prune' not in sys.argv:
        removed = prune(today)
        print(f'pruned {len(removed)} old dailies')


if __name__ == '__main__':
    main()
