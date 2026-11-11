/**
 * The parcel's journey, from the carrier's tracking events, as the order's
 * shipping state (Admin › Pedidos). Correos' answer is read loosely: the
 * events' text decides ("Entregado", "En reparto", "Ausente"…), and their
 * phase (1 preregistered · 2 on its way · 3 out for delivery · 4 delivered)
 * when the text says nothing known.
 */

export const FULFILLMENT_STATES = [
  'unfulfilled',
  'preparing',
  'shipped',
  'in_transit',
  'out_for_delivery',
  'completed',
  'incident',
  'returned',
] as const;
export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

export type TrackingEvent = { at: string | null; text: string; phase?: number | null };

const plain = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const has = (text: string, words: string[]) => words.some((word) => text.includes(word));

/** What one event means for the order; null when it means nothing new (preregistered, unknown). */
export function carrierStatusOf(event: { text: string; phase?: number | null }): FulfillmentState | null {
  const text = plain(event.text);
  if (has(text, ['devuelto', 'devolucion al remitente', 'en devolucion', 'returned to sender', 'return to sender'])) return 'returned';
  if (
    has(text, [
      'no entregado',
      'ausente',
      'incidencia',
      'direccion incorrecta',
      'desconocido',
      'rehusado',
      'disponible en oficina',
      'disponible para recoger',
      'listo para recoger',
      'not delivered',
      'undelivered',
      'absent',
      'failed',
      'ready for pickup',
    ])
  )
    return 'incident';
  if (has(text, ['entregado', 'delivered'])) return 'completed';
  if (has(text, ['en reparto', 'en entrega', 'out for delivery'])) return 'out_for_delivery';
  if (has(text, ['pre-registrado', 'prerregistrado', 'preregistrado', 'preregistered', 'pre-registered'])) return null;
  if (has(text, ['admitido', 'en transito', 'en camino', 'clasificad', 'en tratamiento', 'llegada', 'salida', 'accepted', 'in transit']))
    return 'in_transit';
  switch (event.phase) {
    case 2:
      return 'in_transit';
    case 3:
      return 'out_for_delivery';
    case 4:
      return 'completed';
    default:
      return null;
  }
}

/** "08/11/2026" + "17:00:00" (Madrid time) or an ISO date, as ISO with its offset. */
function when(date: unknown, time: unknown): string | null {
  const d = String(date ?? '').trim();
  if (!d) return null;
  const spanish = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d);
  if (!spanish) {
    const parsed = new Date(d);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const [, day, month, year] = spanish;
  const [hh = '00', mm = '00', ss = '00'] = String(time ?? '').trim().split(':');
  const local = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.padStart(2, '0')}`;
  // Madrid's offset that day (+01:00 or +02:00).
  const probe = new Date(`${local}Z`);
  const name = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Madrid', timeZoneName: 'longOffset' })
    .formatToParts(probe)
    .find((part) => part.type === 'timeZoneName')?.value;
  const offset = /GMT([+-]\d{2}:\d{2})/.exec(name ?? '')?.[1] ?? '+01:00';
  return `${local}${offset}`;
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Every events list in the answer, whatever its shape. */
function eventLists(node: unknown, depth = 0): unknown[][] {
  if (depth > 4 || !node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((item) => eventLists(item, depth + 1));
  const record = node as Record<string, unknown>;
  const own = ['events', 'eventos', 'event'].map((key) => record[key]).filter(Array.isArray) as unknown[][];
  const nested = Object.values(record).flatMap((value) =>
    value && typeof value === 'object' ? eventLists(value, depth + 1) : [],
  );
  return [...own, ...nested.filter((list) => !own.includes(list))];
}

export function parseCorreosTracking(payload: unknown): {
  events: TrackingEvent[];
  status: FulfillmentState | null;
  summary: string | null;
} {
  const events: TrackingEvent[] = [];
  for (const list of eventLists(payload)) {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as Record<string, unknown>;
      const label =
        text(e.summaryText) ?? text(e.desTextoResumen) ?? text(e.description) ?? text(e.extendedText) ?? text(e.desTextoAmpliado) ?? text(e.text);
      if (!label) continue;
      const phase = Number(e.phase ?? e.fase);
      events.push({
        at: when(e.eventDate ?? e.fecha ?? e.date, e.eventTime ?? e.hora ?? e.time),
        text: label,
        phase: Number.isFinite(phase) && phase > 0 ? phase : null,
      });
    }
  }
  events.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const latest = events[events.length - 1];
  // The latest event that says something about the journey decides.
  const status = [...events].reverse().map(carrierStatusOf).find((s) => s !== null) ?? null;
  return { events, status, summary: latest?.text ?? null };
}

const RANK: Record<string, number> = {
  unfulfilled: 0,
  preparing: 1,
  shipped: 2,
  in_transit: 3,
  out_for_delivery: 4,
  completed: 5,
};

/** The order's state after what the carrier says: forward only; trouble at once; delivered and returned stay. */
export function nextFulfillment(current: string, carrier: FulfillmentState | null): string {
  if (!carrier || current === 'completed' || current === 'returned') return current;
  if (carrier === 'incident' || carrier === 'returned') return carrier;
  if (current === 'incident') return carrier;
  return (RANK[carrier] ?? 0) > (RANK[current] ?? 0) ? carrier : current;
}
