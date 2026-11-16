import type { Db } from '@/lib/server/db';
import { googleMerchantConfig, metaCatalogConfig } from '@/lib/catalog/syncCatalog';
import { hasResend } from '@/lib/server/env';
import { hasDatabase } from '@/lib/server/db';
import { checkoutProviders } from '@/lib/server/payments/config';
import { resolveMediaUrl } from '@/lib/server/storageUrl';

const TZ = 'Europe/Madrid';
const DAY = 24 * 60 * 60 * 1000;

export type WallPiece = {
  id: string;
  title: string;
  category: string;
  src: string | null;
  published: boolean;
  needsText: boolean;
};

export type Todo = { text: string; href: string; action: string; tone: 'warn' | 'info' };

export type DayVisits = { key: string; label: string; visits: number };

export type Overview = {
  wall: WallPiece[];
  counts: {
    works: number;
    worksPublished: number;
    gallery: number;
    products: number;
    productsOnSale: number;
    media: number;
  };
  visits: {
    days: DayVisits[];
    thisWeek: number;
    lastWeek: number;
    views: number;
  };
  commissions: Array<{
    id: string;
    reference: string;
    contact_name: string;
    subjects: string | null;
    status: string;
    created_at: string;
  }>;
  orders: Array<{
    id: string;
    reference: string;
    payment_status: string;
    fulfillment_status: string;
    total_cents: number;
    customer_email: string | null;
    created_at: string;
  }>;
  todos: Todo[];
  setup: Array<{ label: string; ok: boolean; href: string }>;
};

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(date);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Same shapes the Supabase calls returned, so the summary below reads them unchanged.
const asData = (data: unknown[]) => ({ data });
const asCount = (row: { count: number } | null) => ({ count: row?.count ?? 0 });

export async function loadOverview(client: Db): Promise<Overview> {
  const now = Date.now();
  const since = new Date(now - 14 * DAY).toISOString();

  const [
    artworks,
    gallery,
    products,
    media,
    commissions,
    newCommissions,
    orders,
    toShip,
    views,
    settings,
  ] = await Promise.all([
    client.rows`
      select a.id, a.title_es, a.title_en, a.category, a.published, a.summary_es, a.story_es, a.sort_order, a.updated_at,
             coalesce((select json_agg(json_build_object('src', x.src, 'role', x.role, 'sort_order', x.sort_order))
                       from public.artwork_assets x where x.artwork_id = a.id), '[]'::json) as artwork_assets
      from public.artworks a order by a.updated_at desc, a.sort_order asc`.then(asData),
    client.rows`select id, published from public.gallery_items`.then(asData),
    client.rows`
      select p.id, p.status, p.sale_enabled,
             (select json_build_object('inventory_mode', i.inventory_mode) from public.inventory i where i.product_id = p.id) as inventory
      from public.products p`.then(asData),
    client.rows`
      select m.id, coalesce((select json_agg(json_build_object('locale', t.locale, 'alt_text', t.alt_text))
                             from public.media_translations t where t.media_asset_id = m.id), '[]'::json) as media_translations
      from public.media_assets m`.then(asData),
    client.rows`
      select id, reference, contact_name, subjects, status, created_at from public.commission_requests
      order by created_at desc limit 5`.then(asData),
    client.one<{ count: number }>`select count(*) as count from public.commission_requests where status = 'received'`.then(asCount),
    client.rows`
      select id, reference, payment_status, fulfillment_status, total_cents, customer_email, created_at
      from public.orders order by created_at desc limit 5`.then(asData),
    client.one<{ count: number }>`
      select count(*) as count from public.orders
      where payment_status = 'paid' and fulfillment_status in ('unfulfilled', 'preparing')`.then(asCount),
    client.rows`select viewed_at, session_hash from public.page_views where viewed_at >= ${since} limit 50000`.then(asData),
    client.one<{ sales_enabled: boolean; payments_enabled: boolean }>`
      select sales_enabled, payments_enabled from public.shop_settings where id = 1`.then((data) => ({ data })),
  ]);

  type ArtworkRow = {
    id: string;
    title_es: string;
    title_en: string;
    category: string;
    published: boolean;
    summary_es: string;
    story_es: string;
    artwork_assets: Array<{ src: string; role: string; sort_order: number }>;
  };
  const works = (artworks.data ?? []) as unknown as ArtworkRow[];
  const needsText = (w: ArtworkRow) => !w.summary_es?.trim() && !w.story_es?.trim();

  const wall: WallPiece[] = works.slice(0, 7).map((w) => {
    const assets = [...(w.artwork_assets ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const drawing = assets.find((a) => a.role === 'drawing') ?? assets[0];
    return {
      id: w.id,
      title: w.title_es || w.title_en,
      category: w.category,
      // Stored as /media/... paths, which only exist locally; serve them from Storage.
      src: resolveMediaUrl(drawing?.src) || null,
      published: w.published,
      needsText: needsText(w),
    };
  });

  type ProductRow = {
    status: string;
    sale_enabled: boolean;
    inventory: { inventory_mode: string } | Array<{ inventory_mode: string }> | null;
  };
  const productRows = (products.data ?? []) as unknown as ProductRow[];
  const modeOf = (p: ProductRow) =>
    Array.isArray(p.inventory) ? p.inventory[0]?.inventory_mode : p.inventory?.inventory_mode;
  const unverified = productRows.filter((p) => modeOf(p) === 'unverified').length;

  type MediaRow = { media_translations: Array<{ locale: string; alt_text: string }> };
  const mediaRows = (media.data ?? []) as unknown as MediaRow[];
  const mediaWithoutAlt = mediaRows.filter(
    (m) => !(m.media_translations ?? []).some((t) => t.locale === 'es' && t.alt_text?.trim()),
  ).length;

  const viewRows = (views.data ?? []) as Array<{ viewed_at: string; session_hash: string }>;
  const sessionsByDay = new Map<string, Set<string>>();
  const thisWeekSessions = new Set<string>();
  const lastWeekSessions = new Set<string>();
  let weekViews = 0;
  for (const row of viewRows) {
    const at = new Date(row.viewed_at);
    const key = dayKey(at);
    const set = sessionsByDay.get(key) ?? new Set<string>();
    set.add(row.session_hash);
    sessionsByDay.set(key, set);
    if (now - at.getTime() < 7 * DAY) {
      thisWeekSessions.add(row.session_hash);
      weekViews += 1;
    } else {
      lastWeekSessions.add(row.session_hash);
    }
  }
  const weekday = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: TZ });
  const days: DayVisits[] = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now - (6 - i) * DAY);
    const key = dayKey(date);
    return {
      key,
      label: weekday.format(date).replace('.', ''),
      visits: sessionsByDay.get(key)?.size ?? 0,
    };
  });

  const newCount = newCommissions.count ?? 0;
  const shipCount = toShip.count ?? 0;
  const worksWithoutText = works.filter(needsText).length;
  const salesEnabled = Boolean(settings.data?.sales_enabled);

  const todos: Todo[] = [];
  if (newCount > 0) {
    todos.push({
      text: `${plural(newCount, 'encargo nuevo', 'encargos nuevos')} esperando respuesta`,
      href: '/admin/commissions/?estado=received',
      action: 'Responder',
      tone: 'warn',
    });
  }
  if (shipCount > 0) {
    todos.push({
      text: `${plural(shipCount, 'pedido pagado', 'pedidos pagados')} por preparar`,
      href: '/admin/orders/?filtro=por-enviar',
      action: 'Preparar',
      tone: 'warn',
    });
  }
  if (unverified > 0) {
    todos.push({
      text: `${plural(unverified, 'producto', 'productos')} con el inventario sin verificar`,
      href: '/admin/products/?inventario=unverified',
      action: 'Revisar stock',
      tone: 'info',
    });
  }
  if (worksWithoutText > 0) {
    todos.push({
      text: `${plural(worksWithoutText, 'ficha de obra', 'fichas de obra')} sin descripción ni proceso`,
      href: '/admin/work/?filtro=sin-texto',
      action: 'Escribir',
      tone: 'info',
    });
  }
  if (mediaWithoutAlt > 0) {
    todos.push({
      text: `${plural(mediaWithoutAlt, 'imagen', 'imágenes')} sin texto alternativo en español`,
      href: '/admin/media/?filtro=sin-alt',
      action: 'Describir',
      tone: 'info',
    });
  }

  const setup = [
    { label: 'Base de datos y fotos', ok: hasDatabase(), href: '/admin/settings/' },
    { label: 'Cobros con Stripe o PayPal', ok: (await checkoutProviders()).length > 0, href: '/admin/settings/#cobros' },
    { label: 'Correo de avisos', ok: hasResend(), href: '/admin/settings/' },
    { label: 'Google Merchant Center', ok: Boolean(googleMerchantConfig()), href: '/admin/settings/' },
    { label: 'Catálogo de Meta', ok: Boolean(metaCatalogConfig()), href: '/admin/settings/' },
    { label: 'Venta activada', ok: salesEnabled, href: '/admin/settings/' },
  ];

  return {
    wall,
    counts: {
      works: works.length,
      worksPublished: works.filter((w) => w.published).length,
      gallery: (gallery.data ?? []).length,
      products: productRows.length,
      productsOnSale: productRows.filter((p) => p.sale_enabled && p.status === 'published').length,
      media: mediaRows.length,
    },
    visits: {
      days,
      thisWeek: thisWeekSessions.size,
      lastWeek: lastWeekSessions.size,
      views: weekViews,
    },
    commissions: (commissions.data ?? []) as Overview['commissions'],
    orders: (orders.data ?? []) as Overview['orders'],
    todos,
    setup,
  };
}
