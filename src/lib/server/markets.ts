import { z } from 'zod';
import type { Market } from '@/lib/domain/markets';
import { madridDay } from '@/lib/domain/holidays';
import { serviceDb, type Db } from '@/lib/server/db';

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
};

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
});

/** Every market, newest first (Admin). */
export async function allMarkets(client: Db): Promise<Market[]> {
  const rows = await client.rows<Row>`select * from public.markets order by starts_on desc`;
  return rows.map(toMarket);
}

const KEEP_MS = 5 * 60_000;
let cached: { at: number; value: Promise<Market[]> } | null = null;

/** Published markets still to come, soonest first (public pages; kept five minutes). */
export function publicMarkets(): Promise<Market[]> {
  if (!cached || Date.now() - cached.at > KEEP_MS) {
    const db = serviceDb();
    const value = db
      ? db.rows<Row>`
          select * from public.markets where published and ends_on >= ${madridDay()}::date order by starts_on, name`
          .then((rows) => rows.map(toMarket))
          .catch(() => [])
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
  })
  .strict()
  .refine((m) => m.endsOn >= m.startsOn, 'El último día no puede ser anterior al primero.');

export type MarketInput = z.output<typeof marketSchema>;

export async function saveMarket(client: Db, m: MarketInput): Promise<string> {
  const values = [m.name, m.place, m.city, m.startsOn, m.endsOn, m.hours, m.notesEs, m.notesEn, m.mapUrl, m.pickup, m.published] as const;
  if (m.id) {
    const row = await client.one<{ id: string }>`
      update public.markets set name = ${values[0]}, place = ${values[1]}, city = ${values[2]},
        starts_on = ${values[3]}::date, ends_on = ${values[4]}::date, hours = ${values[5]},
        notes_es = ${values[6]}, notes_en = ${values[7]}, map_url = ${values[8]}, pickup = ${values[9]}, published = ${values[10]}
      where id = ${m.id} returning id`;
    if (!row) throw new Error('MARKET_NOT_FOUND');
    cached = null;
    return row.id;
  }
  const row = await client.one<{ id: string }>`
    insert into public.markets (name, place, city, starts_on, ends_on, hours, notes_es, notes_en, map_url, pickup, published)
    values (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}::date, ${values[4]}::date, ${values[5]},
            ${values[6]}, ${values[7]}, ${values[8]}, ${values[9]}, ${values[10]})
    returning id`;
  cached = null;
  return row!.id;
}

export async function deleteMarket(client: Db, id: string): Promise<void> {
  await client.run`delete from public.markets where id = ${id}`;
  cached = null;
}
