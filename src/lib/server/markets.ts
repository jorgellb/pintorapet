import { z } from 'zod';
import type { Market } from '@/lib/domain/markets';
import { madridDay } from '@/lib/domain/holidays';
import { serviceDb, sql, type Db } from '@/lib/server/db';
import { storagePublicUrl } from '@/lib/server/storageUrl';

/** Markets (Admin › Mercados) as the pages read them. */
type Row = {
  id: string;
  name: string;
  place: string;
  city: string;
  starts_on: string;
  ends_on: string;
  hours: string;
  notes_es: string;
  notes_en: string;
  map_url: string | null;
  pickup: boolean;
  published: boolean;
  photos: Array<{ id: string; bucket: string; object_path: string; alt_es: string; alt_en: string }> | null;
};

/** A market's photos, in order, as JSON (with their alt texts). */
const PHOTOS = sql`coalesce((
  select json_agg(json_build_object(
           'id', a.id, 'bucket', a.bucket, 'object_path', a.object_path,
           'alt_es', coalesce((select t.alt_text from public.media_translations t where t.media_asset_id = a.id and t.locale = 'es'), ''),
           'alt_en', coalesce((select t.alt_text from public.media_translations t where t.media_asset_id = a.id and t.locale = 'en'), ''))
         order by p.position)
  from public.market_photos p join public.media_assets a on a.id = p.media_asset_id
  where p.market_id = m.id), '[]'::json) as photos`;

const toMarket = (r: Row): Market => ({
  id: r.id,
  name: r.name,
  place: r.place,
  city: r.city,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  hours: r.hours,
  notesEs: r.notes_es,
  notesEn: r.notes_en,
  mapUrl: r.map_url,
  pickup: r.pickup,
  published: r.published,
  photos: (r.photos ?? []).map((ph) => ({
    id: ph.id,
    url: storagePublicUrl(ph.bucket, ph.object_path),
    altEs: ph.alt_es,
    altEn: ph.alt_en,
  })),
});

/** Every market, newest first (Admin). */
export async function allMarkets(client: Db): Promise<Market[]> {
  const rows = await client.rows<Row>`select m.*, ${PHOTOS} from public.markets m order by m.starts_on desc`;
  return rows.map(toMarket);
}

const KEEP_MS = 5 * 60_000;
let cached: { at: number; value: Promise<Market[]> } | null = null;

/** Published markets still to come, soonest first (public pages; kept five minutes, a failed read is not kept). */
export function publicMarkets(): Promise<Market[]> {
  if (!cached || Date.now() - cached.at > KEEP_MS) {
    const db = serviceDb();
    const value: Promise<Market[]> = db
      ? db.rows<Row>`
          select m.*, ${PHOTOS} from public.markets m
          where m.published and m.ends_on >= ${madridDay()}::date order by m.starts_on, m.name`
          .then((rows) => rows.map(toMarket))
          .catch((err: unknown) => {
            console.error('[markets] read failed', err instanceof Error ? err.message : err);
            if (cached?.value === value) cached = null;
            return [];
          })
      : Promise.resolve([]);
    cached = { at: Date.now(), value };
  }
  return cached.value;
}

const text = (max: number) => z.string().trim().max(max).default('');

export const marketSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2).max(120),
    place: text(200),
    city: text(100),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    hours: text(80),
    notesEs: text(500),
    notesEn: text(500),
    mapUrl: z
      .string()
      .trim()
      .max(500)
      .default('')
      .refine((v) => v === '' || /^https:\/\//.test(v), 'El enlace del mapa debe empezar por https://')
      .transform((v) => v || null),
    pickup: z.boolean().default(false),
    published: z.boolean().default(true),
    /** Images from Medios, in the order they are shown. */
    photoIds: z.array(z.uuid()).max(12).default([]),
  })
  .strict()
  .refine((m) => m.endsOn >= m.startsOn, 'El último día no puede ser anterior al primero.');

export type MarketInput = z.output<typeof marketSchema>;

/** Replace a market's photos with these, in this order. */
async function savePhotos(client: Db, marketId: string, photoIds: string[]): Promise<void> {
  await client.run`delete from public.market_photos where market_id = ${marketId}`;
  const ids = [...new Set(photoIds)];
  if (ids.length === 0) return;
  await client.run`
    insert into public.market_photos (market_id, media_asset_id, position)
    select ${marketId}, t.id, t.ord - 1 from unnest(${ids}::uuid[]) with ordinality as t(id, ord)`;
}

/** Run inside one transaction (asUser), so the market and its photos change together. */
export async function saveMarket(client: Db, m: MarketInput): Promise<string> {
  const values = [m.name, m.place, m.city, m.startsOn, m.endsOn, m.hours, m.notesEs, m.notesEn, m.mapUrl, m.pickup, m.published] as const;
  if (m.id) {
    const row = await client.one<{ id: string }>`
      update public.markets set name = ${values[0]}, place = ${values[1]}, city = ${values[2]},
        starts_on = ${values[3]}::date, ends_on = ${values[4]}::date, hours = ${values[5]},
        notes_es = ${values[6]}, notes_en = ${values[7]}, map_url = ${values[8]}, pickup = ${values[9]}, published = ${values[10]}
      where id = ${m.id} returning id`;
    if (!row) throw new Error('MARKET_NOT_FOUND');
    await savePhotos(client, row.id, m.photoIds);
    cached = null;
    return row.id;
  }
  const row = await client.one<{ id: string }>`
    insert into public.markets (name, place, city, starts_on, ends_on, hours, notes_es, notes_en, map_url, pickup, published)
    values (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}::date, ${values[4]}::date, ${values[5]},
            ${values[6]}, ${values[7]}, ${values[8]}, ${values[9]}, ${values[10]})
    returning id`;
  await savePhotos(client, row!.id, m.photoIds);
  cached = null;
  return row!.id;
}

export async function deleteMarket(client: Db, id: string): Promise<void> {
  await client.run`delete from public.markets where id = ${id}`;
  cached = null;
}
