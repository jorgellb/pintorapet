import { couponSummary, KIND_VALUE_FIELDS, type Coupon, type CouponKind } from '@/lib/domain/coupons';

/**
 * Admin › Cupones, the form's rules without the DOM: what Meili types becomes the
 * body the API takes, and the same body feeds the live one-line summary. The page
 * script only reads the fields and calls these.
 */

export type CouponFormValues = {
  id: string;
  code: string;
  note: string;
  status: 'active' | 'paused' | 'archived';
  kind: CouponKind;
  /** Free text, as typed: "10", "7,5". */
  percent: string;
  amount: string;
  cap: string;
  buyQty: string;
  getQty: string;
  nth: string;
  categoryIds: string[];
  collectionIds: string[];
  productIds: string[];
  excludedProductIds: string[];
  minSubtotal: string;
  minUnits: string;
  zoneIds: string[];
  allowShipping: boolean;
  allowPickup: boolean;
  firstOrderOnly: boolean;
  requireAccount: boolean;
  /** One per line (commas and spaces split too). */
  emails: string;
  emailsRequireAccount: boolean;
  /** YYYY-MM-DD, the first day. */
  startDay: string;
  /** YYYY-MM-DD, the last day (included). */
  endDay: string;
  /** 1 (Monday) to 7 (Sunday). */
  weekdays: number[];
  maxUses: string;
  maxUsesPerCustomer: string;
  announce: boolean;
};

export type Names = Parameters<typeof couponSummary>[1];

// --- Madrid days ---------------------------------------------------------------

const madridParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const partsOf = (at: number) => {
  const p = Object.fromEntries(madridParts.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
};

/** The calendar day (YYYY-MM-DD) in Spain of an instant. */
export const madridDayOf = (iso: string): string => partsOf(Date.parse(iso)).day;

/** The day after a YYYY-MM-DD one. */
export function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

/** 00:00 on a day in Spain, as an ISO instant (Madrid is UTC+1 or UTC+2, and midnight is never skipped). */
export function madridMidnight(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  for (const offsetHours of [1, 2]) {
    const at = Date.UTC(y!, m! - 1, d!) - offsetHours * 3_600_000;
    const p = partsOf(at);
    if (p.day === day && p.hour === 0 && p.minute === 0) return new Date(at).toISOString();
  }
  throw new Error(`Not a day: ${day}`);
}

/** Where a coupon's "hasta" is saved: the end is exclusive, so «hasta el 24» is 25 at midnight. */
export const endsAtFromDay = (lastDay: string): string => madridMidnight(nextDay(lastDay));

/** The last day of a coupon, as «hasta» shows it: the day before an end at midnight. */
export function lastDayFromEndsAt(endsAt: string): string {
  const p = partsOf(Date.parse(endsAt));
  return p.hour === 0 && p.minute === 0 ? partsOf(Date.parse(endsAt) - 12 * 3_600_000).day : p.day;
}

// --- numbers -------------------------------------------------------------------

/** "7,5" and "7.5" are both 7.5; empty is null; anything else is not a number. */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** 550 → "5,5"; 500 → "5"; shown back in the field. */
export const centsToField = (cents: number | null): string =>
  cents === null ? '' : String(cents / 100).replace('.', ',');

export const numberToField = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));

// --- form → body ---------------------------------------------------------------

const splitEmails = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

export type CouponBody = {
  id?: string;
  code: string;
  note: string;
  status: CouponFormValues['status'];
  kind: CouponKind;
  percent: number | null;
  amountCents: number | null;
  capCents: number | null;
  buyQty: number | null;
  getQty: number | null;
  nth: number | null;
  categoryIds: string[];
  collectionIds: string[];
  productIds: string[];
  excludedProductIds: string[];
  minSubtotalCents: number | null;
  minUnits: number | null;
  zoneIds: string[];
  allowShipping: boolean;
  allowPickup: boolean;
  firstOrderOnly: boolean;
  requireAccount: boolean;
  emails: string[];
  emailsRequireAccount: boolean;
  startsAt: string | null;
  endsAt: string | null;
  weekdays: number[];
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  announce: boolean;
};

/** What each kind needs, to tell Meili what is missing before she saves. */
const NEEDS: Record<CouponKind, Array<[keyof CouponBody, string]>> = {
  percent: [['percent', 'Indica el porcentaje de descuento.']],
  fixed: [['amountCents', 'Indica el importe del descuento.']],
  free_shipping: [],
  buy_x_get_y: [
    ['buyQty', 'Indica cuántas piezas hay que comprar.'],
    ['getQty', 'Indica cuántas piezas salen gratis.'],
  ],
  nth_unit: [
    ['nth', 'Indica qué unidad lleva el descuento.'],
    ['percent', 'Indica el porcentaje de descuento.'],
  ],
};

export type BuiltBody = { body: CouponBody; problem: string | null };

/**
 * The body for the API. `problem` is the first thing wrong that the server would
 * also refuse: a field that is not a number, a missing value, the dates in the
 * wrong order. The server checks everything again; this is for the live summary
 * and for an early, plain message.
 */
export function buildCouponBody(v: CouponFormValues): BuiltBody {
  let problem: string | null = null;
  const fail = (message: string) => {
    problem ??= message;
  };
  const number = (text: string, label: string): number | null => {
    const n = parseDecimal(text);
    if (n !== null && Number.isNaN(n)) {
      fail(`«${label}» tiene que ser un número.`);
      return null;
    }
    return n;
  };
  const whole = (text: string, label: string): number | null => {
    const n = number(text, label);
    if (n !== null && !Number.isInteger(n)) {
      fail(`«${label}» tiene que ser un número entero.`);
      return null;
    }
    return n;
  };
  const cents = (text: string, label: string): number | null => {
    const n = number(text, label);
    return n === null ? null : Math.round(n * 100);
  };
  // Only the chosen kind's values are read: the fields of the others stay hidden with whatever was left in them.
  const uses: readonly string[] = KIND_VALUE_FIELDS[v.kind];
  const ofKind = <T>(key: (typeof KIND_VALUE_FIELDS)[CouponKind][number], read: () => T): T | null => (uses.includes(key) ? read() : null);

  const startsAt = v.startDay ? madridMidnight(v.startDay) : null;
  const endsAt = v.endDay ? endsAtFromDay(v.endDay) : null;
  if (v.startDay && v.endDay && v.endDay < v.startDay) fail('El último día no puede ser anterior al primero.');

  const body: CouponBody = {
    ...(v.id ? { id: v.id } : {}),
    code: v.code,
    note: v.note,
    status: v.status,
    kind: v.kind,
    percent: ofKind('percent', () => number(v.percent, 'Porcentaje')),
    amountCents: ofKind('amountCents', () => cents(v.amount, 'Importe')),
    capCents: ofKind('capCents', () => cents(v.cap, 'Tope')),
    buyQty: ofKind('buyQty', () => whole(v.buyQty, 'Compra')),
    getQty: ofKind('getQty', () => whole(v.getQty, 'Gratis')),
    nth: ofKind('nth', () => whole(v.nth, 'Unidad')),
    categoryIds: v.categoryIds,
    collectionIds: v.collectionIds,
    productIds: v.productIds,
    excludedProductIds: v.excludedProductIds,
    minSubtotalCents: cents(v.minSubtotal, 'Compra mínima'),
    minUnits: whole(v.minUnits, 'Mínimo de piezas'),
    zoneIds: v.zoneIds,
    allowShipping: v.allowShipping,
    allowPickup: v.allowPickup,
    firstOrderOnly: v.firstOrderOnly,
    requireAccount: v.requireAccount,
    emails: splitEmails(v.emails),
    emailsRequireAccount: v.emailsRequireAccount,
    startsAt,
    endsAt,
    weekdays: v.weekdays,
    maxUses: whole(v.maxUses, 'Usos totales'),
    maxUsesPerCustomer: whole(v.maxUsesPerCustomer, 'Usos por cliente'),
    announce: v.announce,
  };
  for (const [key, message] of NEEDS[v.kind]) if (body[key] === null) fail(message);
  if (!v.allowShipping && !v.allowPickup) fail('El cupón tiene que valer para envío o para recogida.');
  return { body, problem };
}

/** The coupon as couponSummary reads it, from what is in the form. */
export const bodyToCoupon = (b: CouponBody): Coupon => ({
  ...b,
  id: b.id ?? '',
  version: 0,
  // The summary only describes what its kind uses (the server drops the rest the same way).
  percent: b.kind === 'percent' || b.kind === 'nth_unit' ? b.percent : null,
  amountCents: b.kind === 'fixed' ? b.amountCents : null,
  capCents: b.kind === 'percent' || b.kind === 'free_shipping' ? b.capCents : null,
  buyQty: b.kind === 'buy_x_get_y' ? b.buyQty : null,
  getQty: b.kind === 'buy_x_get_y' ? b.getQty : null,
  nth: b.kind === 'nth_unit' ? b.nth : null,
});

/** The line at the top of the form: the coupon in one sentence, or what stops it from being one. */
export function liveSummary(v: CouponFormValues, names: Names): { text: string; ready: boolean } {
  const { body, problem } = buildCouponBody(v);
  const missing = NEEDS[v.kind].some(([key]) => body[key] === null);
  if (missing || problem) return { text: problem ?? 'Completa el descuento.', ready: false };
  return { text: couponSummary(bodyToCoupon(body), names), ready: true };
}

/** A saved coupon back into the form's fields. */
export function couponToValues(c: Coupon): CouponFormValues {
  return {
    id: c.id,
    code: c.code,
    note: c.note,
    status: c.status,
    kind: c.kind,
    percent: numberToField(c.percent),
    amount: centsToField(c.amountCents),
    cap: centsToField(c.capCents),
    buyQty: numberToField(c.buyQty),
    getQty: numberToField(c.getQty),
    nth: numberToField(c.nth),
    categoryIds: c.categoryIds,
    collectionIds: c.collectionIds,
    productIds: c.productIds,
    excludedProductIds: c.excludedProductIds,
    minSubtotal: centsToField(c.minSubtotalCents),
    minUnits: numberToField(c.minUnits),
    zoneIds: c.zoneIds,
    allowShipping: c.allowShipping,
    allowPickup: c.allowPickup,
    firstOrderOnly: c.firstOrderOnly,
    requireAccount: c.requireAccount,
    emails: c.emails.join('\n'),
    emailsRequireAccount: c.emailsRequireAccount,
    startDay: c.startsAt ? madridDayOf(c.startsAt) : '',
    endDay: c.endsAt ? lastDayFromEndsAt(c.endsAt) : '',
    weekdays: c.weekdays,
    maxUses: numberToField(c.maxUses),
    maxUsesPerCustomer: numberToField(c.maxUsesPerCustomer),
    announce: c.announce,
  };
}

/** A blank coupon: 10 % off the whole shop, active. */
export const emptyValues = (): CouponFormValues => ({
  id: '',
  code: '',
  note: '',
  status: 'active',
  kind: 'percent',
  percent: '',
  amount: '',
  cap: '',
  buyQty: '2',
  getQty: '1',
  nth: '2',
  categoryIds: [],
  collectionIds: [],
  productIds: [],
  excludedProductIds: [],
  minSubtotal: '',
  minUnits: '',
  zoneIds: [],
  allowShipping: true,
  allowPickup: true,
  firstOrderOnly: false,
  requireAccount: false,
  emails: '',
  emailsRequireAccount: false,
  startDay: '',
  endDay: '',
  weekdays: [],
  maxUses: '',
  maxUsesPerCustomer: '',
  announce: false,
});

// --- the list ------------------------------------------------------------------

const shortDay = (day: string) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`))
    .replace('.', '');

/** «Siempre», «1 dic – 24 dic», «Desde 1 dic», «Hasta 24 dic»; and where today falls in it. */
export function validity(
  c: Pick<Coupon, 'startsAt' | 'endsAt'>,
  now: number = Date.now(),
): { text: string; state: 'always' | 'live' | 'scheduled' | 'ended' } {
  const start = c.startsAt ? madridDayOf(c.startsAt) : null;
  const end = c.endsAt ? lastDayFromEndsAt(c.endsAt) : null;
  const text =
    start && end ? `${shortDay(start)} – ${shortDay(end)}` : start ? `Desde ${shortDay(start)}` : end ? `Hasta ${shortDay(end)}` : 'Siempre';
  if (c.endsAt && Date.parse(c.endsAt) <= now) return { text, state: 'ended' };
  if (c.startsAt && Date.parse(c.startsAt) > now) return { text, state: 'scheduled' };
  return { text, state: start || end ? 'live' : 'always' };
}
