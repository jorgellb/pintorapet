import { z } from 'zod';
import { formatEur } from './money';

/**
 * Coupons (Admin › Cupones). The database prices them (coupon_price); this is
 * what the pages and the API know about them: the reasons a code is refused,
 * the copy for each, the shape Admin saves and a one-line summary.
 */

export const COUPON_REASONS = [
  'COUPON_NOT_FOUND',
  'COUPON_NOT_STARTED',
  'COUPON_EXPIRED',
  'COUPON_WRONG_DAY',
  'COUPON_NO_ITEMS',
  'COUPON_MIN_SUBTOTAL',
  'COUPON_MIN_UNITS',
  'COUPON_ZONE',
  'COUPON_PICKUP',
  'COUPON_SHIPPING',
  'COUPON_FIRST_ORDER',
  'COUPON_ACCOUNT',
  'COUPON_EMAIL',
  'COUPON_USED',
  'COUPON_SOLD_OUT',
  'COUPON_CHANGED',
] as const;

/** Why a code does not apply: what coupon_price and claim_order_coupon say, plus a coupon edited meanwhile. */
export type CouponReason = (typeof COUPON_REASONS)[number];

export const isCouponReason = (value: unknown): value is CouponReason =>
  typeof value === 'string' && (COUPON_REASONS as readonly string[]).includes(value);

export type CouponKind = 'percent' | 'fixed' | 'free_shipping' | 'buy_x_get_y' | 'nth_unit';
export type CouponStatus = 'active' | 'paused' | 'archived';

/** A coupon as Admin reads it (the table, in camelCase). */
export type Coupon = {
  id: string;
  code: string;
  note: string;
  status: CouponStatus;
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
  version: number;
};

/** Refusals about who is buying: a guest gets only COUPON_EMAIL for these. */
export const COUPON_WHO_REASONS: readonly CouponReason[] = ['COUPON_FIRST_ORDER', 'COUPON_USED', 'COUPON_EMAIL'];

/** The code as typed: trimmed, upper-case, no spaces inside. */
export const normalizeCouponCode = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase();

// --- copy ----------------------------------------------------------------------

type Locale = 'es' | 'en';
type Extra = { missingCents?: number | null; missingUnits?: number | null };

const MESSAGES: Record<CouponReason, { es: (e: Extra, eur: (c: number) => string) => string; en: (e: Extra, eur: (c: number) => string) => string }> = {
  COUPON_NOT_FOUND: {
    es: () => 'Este código no existe o ya no está activo.',
    en: () => 'This code does not exist or is no longer active.',
  },
  COUPON_NOT_STARTED: {
    es: () => 'Este cupón todavía no está activo.',
    en: () => 'This code is not active yet.',
  },
  COUPON_EXPIRED: {
    es: () => 'Este cupón ha caducado.',
    en: () => 'This code has expired.',
  },
  COUPON_WRONG_DAY: {
    es: () => 'Este cupón no vale hoy.',
    en: () => 'This code is not valid today.',
  },
  COUPON_NO_ITEMS: {
    es: () => 'Ningún producto de tu carrito entra en este cupón.',
    en: () => 'None of the items in your cart are covered by this code.',
  },
  COUPON_MIN_SUBTOTAL: {
    es: (e, eur) =>
      e.missingCents ? `Este cupón es para compras mayores; te faltan ${eur(e.missingCents)}.` : 'Este cupón es para compras mayores.',
    en: (e, eur) =>
      e.missingCents ? `This code needs a larger order; add ${eur(e.missingCents)}.` : 'This code needs a larger order.',
  },
  COUPON_MIN_UNITS: {
    es: (e) =>
      e.missingUnits
        ? `Este cupón necesita más piezas; te ${e.missingUnits === 1 ? 'falta 1' : `faltan ${e.missingUnits}`}.`
        : 'Este cupón necesita más piezas en el carrito.',
    en: (e) =>
      e.missingUnits
        ? `This code needs more items; add ${e.missingUnits}.`
        : 'This code needs more items in your cart.',
  },
  COUPON_ZONE: {
    es: () => 'Este cupón no vale para tu destino de envío.',
    en: () => 'This code is not valid for your shipping destination.',
  },
  COUPON_PICKUP: {
    es: () => 'Este cupón no vale para recogida en mercado.',
    en: () => 'This code is not valid for market pickup.',
  },
  COUPON_SHIPPING: {
    es: () => 'Este cupón solo vale para recogida en mercado.',
    en: () => 'This code is only valid for market pickup.',
  },
  COUPON_FIRST_ORDER: {
    es: () => 'Este cupón es solo para la primera compra.',
    en: () => 'This code is only for a first order.',
  },
  COUPON_ACCOUNT: {
    es: () => 'Para usar este cupón tienes que iniciar sesión.',
    en: () => 'You need to sign in to use this code.',
  },
  // Also what a guest is told for COUPON_FIRST_ORDER and COUPON_USED: an email typed by
  // someone not signed in must not reveal who has bought or is on a list.
  COUPON_EMAIL: {
    es: () => 'Este cupón no se puede usar con este email.',
    en: () => "This code can't be used with this email.",
  },
  COUPON_USED: {
    es: () => 'Ya has usado este cupón.',
    en: () => 'You have already used this code.',
  },
  COUPON_SOLD_OUT: {
    es: () => 'Este cupón se ha agotado.',
    en: () => 'This code has been fully redeemed.',
  },
  COUPON_CHANGED: {
    es: () => 'Este cupón ha cambiado; revisa el resumen del pedido.',
    en: () => 'This code has changed; please check your order summary.',
  },
};

/** A coupon's percent as the locale writes it: "12,5 %" in Spanish, "12.5%" in English. */
export function formatCouponPercent(percent: number, locale: Locale): string {
  const n = new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: 2 }).format(percent);
  return locale === 'es' ? `${n} %` : `${n}%`;
}

/** What to tell the customer when a code does not apply. */
export function couponMessage(reason: CouponReason, locale: Locale, extra: Extra = {}): string {
  return MESSAGES[reason][locale](extra, (cents) => formatEur(cents, locale));
}

// --- Admin form ----------------------------------------------------------------

const intCents = z.number().int().min(1).max(2_000_000_000);
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null);
const idList = z
  .array(z.uuid())
  .max(500)
  .default([])
  .transform((ids) => [...new Set(ids)]);

const KINDS = ['percent', 'fixed', 'free_shipping', 'buy_x_get_y', 'nth_unit'] as const;

/** The value fields each kind uses; the others are left out. */
export const KIND_VALUE_FIELDS = {
  percent: ['percent', 'capCents'],
  fixed: ['amountCents'],
  free_shipping: ['capCents'],
  buy_x_get_y: ['buyQty', 'getQty'],
  nth_unit: ['nth', 'percent'],
} as const satisfies Record<CouponKind, readonly string[]>;

const VALUE_FIELDS = ['percent', 'amountCents', 'capCents', 'buyQty', 'getQty', 'nth'] as const;

/** A value its kind does not use is dropped before it is judged: a leftover from switching kind never blocks a save. */
const dropOtherKinds = (input: unknown): unknown => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const kind = (input as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !Object.hasOwn(KIND_VALUE_FIELDS, kind)) return input;
  const uses: readonly string[] = KIND_VALUE_FIELDS[kind as CouponKind];
  const out: Record<string, unknown> = { ...input };
  for (const key of VALUE_FIELDS) if (!uses.includes(key) && key in out) out[key] = null;
  return out;
};

/** What Admin saves. The same rules as the table's constraints, with messages in Spanish. */
export const couponSchema = z.preprocess(
  dropOtherKinds,
  z
    .object({
      id: z.uuid().optional(),
      code: z
        .string()
        .max(60, 'El código es demasiado largo.')
        .transform(normalizeCouponCode)
        .pipe(z.string().regex(/^[A-Z0-9_-]{3,30}$/, 'El código lleva de 3 a 30 letras, números, guiones o guiones bajos.')),
      note: z.string().trim().max(500, 'La nota admite hasta 500 caracteres.').default(''),
      status: z.enum(['active', 'paused', 'archived']).default('active'),
      kind: z.enum(KINDS),
      percent: optional(z.number().min(1, 'El porcentaje va de 1 a 100.').max(100, 'El porcentaje va de 1 a 100.')),
      amountCents: optional(intCents),
      capCents: optional(intCents),
      buyQty: optional(z.number().int().min(1).max(100)),
      getQty: optional(z.number().int().min(1).max(100)),
      nth: optional(z.number().int().min(2, 'La unidad con descuento es la 2.ª o posterior.').max(100)),
      categoryIds: idList,
      collectionIds: idList,
      productIds: idList,
      excludedProductIds: idList,
      minSubtotalCents: optional(intCents),
      minUnits: optional(z.number().int().min(1).max(1000)),
      zoneIds: idList,
      allowShipping: z.boolean().default(true),
      allowPickup: z.boolean().default(true),
      firstOrderOnly: z.boolean().default(false),
      requireAccount: z.boolean().default(false),
      emails: z
        .array(z.string().trim().toLowerCase().pipe(z.email('Hay un email que no es válido.').max(254)))
        .max(500)
        .default([])
        .transform((emails) => [...new Set(emails)]),
      emailsRequireAccount: z.boolean().default(false),
      startsAt: optional(z.iso.datetime({ offset: true })),
      endsAt: optional(z.iso.datetime({ offset: true })),
      weekdays: z
        .array(z.number().int().min(1, 'Los días van de 1 (lunes) a 7 (domingo).').max(7, 'Los días van de 1 (lunes) a 7 (domingo).'))
        .max(7)
        .default([])
        .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
      maxUses: optional(z.number().int().min(1).max(1_000_000)),
      maxUsesPerCustomer: optional(z.number().int().min(1).max(1_000_000)),
      announce: z.boolean().default(false),
    })
    .strict()
    .superRefine((c, ctx) => {
      const need = (ok: boolean, path: string, message: string) => {
        if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
      };
      need(c.kind !== 'percent' || c.percent !== null, 'percent', 'Indica el porcentaje de descuento.');
      need(c.kind !== 'fixed' || c.amountCents !== null, 'amountCents', 'Indica el importe del descuento.');
      need(c.kind !== 'buy_x_get_y' || c.buyQty !== null, 'buyQty', 'Indica cuántas piezas hay que comprar.');
      need(c.kind !== 'buy_x_get_y' || c.getQty !== null, 'getQty', 'Indica cuántas piezas salen gratis.');
      need(c.kind !== 'nth_unit' || c.nth !== null, 'nth', 'Indica qué unidad lleva el descuento.');
      need(c.kind !== 'nth_unit' || c.percent !== null, 'percent', 'Indica el porcentaje de descuento.');
      need(
        c.startsAt === null || c.endsAt === null || new Date(c.endsAt) > new Date(c.startsAt),
        'endsAt',
        'El final no puede ser anterior al principio.',
      );
      need(c.allowShipping || c.allowPickup, 'allowShipping', 'El cupón tiene que valer para envío o para recogida.');
    }),
);

export type CouponInput = z.output<typeof couponSchema>;

// --- summary -------------------------------------------------------------------

type Names = {
  categories: Map<string, string>;
  collections: Map<string, string>;
  products: Map<string, string>;
  zones: Map<string, string>;
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

const madrid = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

function madridParts(iso: string) {
  const parts = Object.fromEntries(madrid.formatToParts(new Date(iso)).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute! };
}

/** "1 dic", or "1 dic 18:30" when the time is not midnight. */
const dayLabel = (p: ReturnType<typeof madridParts>, withTime: boolean) =>
  `${p.day} ${MONTHS[p.month - 1]}${withTime && (p.hour || p.minute) ? ` ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` : ''}`;

function whenText(startsAt: string | null, endsAt: string | null): string | null {
  const start = startsAt ? madridParts(startsAt) : null;
  let end = endsAt ? madridParts(endsAt) : null;
  // An end at midnight is exclusive: the last day is the one before.
  if (end && endsAt && end.hour === 0 && end.minute === 0) {
    const previous = madridParts(new Date(new Date(endsAt).getTime() - 12 * 3_600_000).toISOString());
    end = { ...previous, hour: 23, minute: 59 };
  }
  const endTimed = end && !(end.hour === 23 && end.minute === 59);
  if (start && end) {
    if (start.month === end.month && start.year === end.year && !start.hour && !start.minute && !endTimed) {
      return `del ${start.day} al ${end.day} ${MONTHS[end.month - 1]}`;
    }
    return `del ${dayLabel(start, true)} al ${dayLabel(end, true)}`;
  }
  if (start) return `desde el ${dayLabel(start, true)}`;
  if (end) return `hasta el ${dayLabel(end, true)}`;
  return null;
}

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;

const named = (ids: string[], map: Map<string, string>) => ids.map((id) => map.get(id) ?? 'producto borrado');

/** The coupon in one line for Admin: what it takes off, where, who, when and how often. */
export function couponSummary(c: Coupon, names: Names): string {
  const what =
    c.kind === 'percent'
      ? `−${formatCouponPercent(c.percent ?? 0, 'es')}${c.capCents ? ` (hasta ${formatEur(c.capCents, 'es')})` : ''}`
      : c.kind === 'fixed'
        ? `−${formatEur(c.amountCents ?? 0, 'es')}`
        : c.kind === 'free_shipping'
          ? `Envío gratis${c.capCents ? ` (hasta ${formatEur(c.capCents, 'es')})` : ''}`
          : c.kind === 'buy_x_get_y'
            ? `Compra ${c.buyQty} y llévate ${c.getQty} gratis`
            : `La ${c.nth}.ª unidad con −${formatCouponPercent(c.percent ?? 0, 'es')}`;

  const targets = [
    ...named(c.categoryIds, names.categories),
    ...named(c.collectionIds, names.collections),
    ...named(c.productIds, names.products),
  ];
  const scope =
    targets.length > 0 ? `en ${list(targets)}` : c.kind === 'free_shipping' ? '' : 'en toda la tienda';
  const except = c.excludedProductIds.length > 0 ? `salvo ${list(named(c.excludedProductIds, names.products))}` : '';

  const parts = [
    [what, scope, except].filter(Boolean).join(' '),
    c.minSubtotalCents ? `compra mínima ${formatEur(c.minSubtotalCents, 'es')}` : '',
    c.minUnits ? `mín. ${c.minUnits} piezas` : '',
    c.zoneIds.length > 0 ? `zonas: ${list(named(c.zoneIds, names.zones))}` : '',
    !c.allowPickup ? 'sin recogida' : '',
    !c.allowShipping ? 'solo recogida' : '',
    c.firstOrderOnly ? 'solo primera compra' : '',
    c.requireAccount ? 'solo con cuenta' : '',
    c.emails.length > 0 ? `${c.emails.length === 1 ? '1 email' : `${c.emails.length} emails`}${c.emailsRequireAccount ? ' con cuenta' : ''}` : '',
    whenText(c.startsAt, c.endsAt) ?? '',
    c.weekdays.length > 0 && c.weekdays.length < 7 ? `solo ${c.weekdays.map((d) => DAYS[d - 1]).join(', ')}` : '',
    c.maxUsesPerCustomer ? `${c.maxUsesPerCustomer} ${c.maxUsesPerCustomer === 1 ? 'uso' : 'usos'} por cliente` : '',
    c.maxUses ? `máx. ${c.maxUses} usos` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
