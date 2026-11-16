#!/usr/bin/env python3
"""List every stored media file for copy-media-to-cloudinary.mjs.

Reads media_assets + storage.objects over the direct Postgres connection (it
works even when the Supabase API is restricted) and, for each file, looks for a
local copy whose MD5 equals the Storage eTag, i.e. the very same bytes.

Usage: python3 scripts/media-manifest.py <out.json> [dir-to-search ...]
Default search dir: public/media. Reads SUPABASE_DB_POOLER, SUPABASE_DB_POOLER_USER
and SUPABASE_DB_PASSWORD from .env.
"""
import hashlib
import json
import os
import sys

import psycopg


def env():
    out = {}
    for line in open('.env'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            out[k] = v.strip().strip('"').strip("'")
    return out


out_path = sys.argv[1]
search = sys.argv[2:] or ['public/media']
e = env()
conn = psycopg.connect(host=e['SUPABASE_DB_POOLER'], port=5432, user=e['SUPABASE_DB_POOLER_USER'],
                       password=e['SUPABASE_DB_PASSWORD'], dbname='postgres', sslmode='require')
conn.read_only = True
rows = conn.execute("""
  select m.bucket, m.object_path, m.mime_type, (o.metadata->>'size')::bigint,
         trim(both '"' from o.metadata->>'eTag')
  from public.media_assets m
  join storage.objects o on o.bucket_id = m.bucket and o.name = m.object_path
  order by m.bucket, m.object_path""").fetchall()
missing_objects = conn.execute("""
  select count(*) from public.media_assets m
  where not exists (select 1 from storage.objects o where o.bucket_id = m.bucket and o.name = m.object_path)""").fetchone()[0]

sizes = {row[3] for row in rows}
by_md5 = {}
for root in search:
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            path = os.path.join(dirpath, name)
            if os.path.getsize(path) not in sizes:
                continue
            with open(path, 'rb') as fh:
                by_md5.setdefault(hashlib.md5(fh.read()).hexdigest(), os.path.abspath(path))

manifest = [
    {'bucket': b, 'objectPath': p, 'mimeType': mime, 'localPath': by_md5.get(etag)}
    for b, p, mime, _size, etag in rows
]
with open(out_path, 'w') as fh:
    json.dump(manifest, fh, indent=1)
local = sum(1 for item in manifest if item['localPath'])
print(f'{len(manifest)} files | identical local copy: {local} | only in Supabase Storage: {len(manifest) - local}'
      + (f' | media_assets rows without a stored file: {missing_objects}' if missing_objects else ''))
print(f'written {out_path}')
