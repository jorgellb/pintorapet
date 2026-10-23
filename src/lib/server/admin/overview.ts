import type { SupabaseClient } from '@supabase/supabase-js';
import { googleMerchantConfig, metaCatalogConfig } from '@/lib/catalog/syncCatalog';
import { hasResend, hasServiceSupabase } from '@/lib/server/env';
import { checkoutProviders } from '@/lib/server/payments/config';

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

export async function loadOverview(client: SupabaseClient): Promise<Overview> {
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
    client
      .from('artworks')
      .select(
        'id, title_es, title_en, category, published, summary_es, story_es, sort_order, updated_at, artwork_assets(src, role, sort_order)',
      )
      .order('updated_at', { ascending: false })
      .order('sort_order', { ascending: true }),
    client.from('gallery_items').select('id, published'),
    client
      .from('products')
      .select('id, status, sale_enabled, inventory(inventory_mode)'),
    client.from('media_assets').select('id, media_translations(locale, alt_text)'),
    client
      .from('commission_requests')
      .select('id, reference, contact_name, subjects, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    client
      .from('commission_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'received'),
    client
      .from('orders')
      .select(
        'id, reference, payment_status, fulfillment_status, total_cents, customer_email, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(5),
    client
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('payment_status', 'paid')
      .in('fulfillment_status', ['unfulfilled', 'preparing']),
    client
      .from('page_views')
      .select('viewed_at, session_hash')
      .gte('viewed_at', since)
      .limit(50000),
    client.from('shop_settings').select('sales_enabled, payments_enabled').eq('id', 1).maybeSingle(),
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
      src: drawing?.src ?? null,
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
    { label: 'Base de datos y fotos', ok: hasServiceSupabase(), href: '/admin/settings/' },
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
