import { serviceDb, setColumns, insertValues, type Db } from '@/lib/server/db';
import type { CouponsRow } from '@/lib/server/dbTypes';
import type { Coupon, CouponInput, CouponStatus } from '@/lib/domain/coupons';
import { CommerceError } from '@/lib/server/commerce/errors';

/** Coupons (Admin › Cupones). RLS: only an admin reads or writes them, so Admin passes `admin.db`. */

export type AnnouncedCoupon = {
  code: string;
  kind: string;
  percent: number | null;
  amountCents: number | null;
  endsAt: string | null;
};

type Announced = AnnouncedCoupon & { startsAt: string | null };

/** The banner's coupon, kept five minutes and forgotten whenever a coupon changes. */
const KEEP_MS = 5 * 60_000;
let announced: { at: number; value: Promise<Announced | null> } | null = null;

const toCoupon = (r: CouponsRow): Coupon => ({
  id: r.id,
  code: r.code,
  note: r.note,
  status: r.status,
  kind: r.kind,
  percent: r.percent,
  amountCents: r.amount_cents,
  capCents: r.cap_cents,
  buyQty: r.buy_qty,
  getQty: r.get_qty,
  nth: r.nth,
  categoryIds: r.category_ids,
  collectionIds: r.collection_ids,
  productIds: r.product_ids,
  excludedProductIds: r.excluded_product_ids,
  minSubtotalCents: r.min_subtotal_cents,
  minUnits: r.min_units,
  zoneIds: r.zone_ids,
  allowShipping: r.allow_shipping,
  allowPickup: r.allow_pickup,
  firstOrderOnly: r.first_order_only,
  requireAccount: r.require_account,
  emails: r.emails,
  emailsRequireAccount: r.emails_require_account,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  weekdays: r.weekdays.map(Number),
  maxUses: r.max_uses,
  maxUsesPerCustomer: r.max_uses_per_customer,
  announce: r.announce,
  version: r.version,
});

export type CouponWithStats = Coupon & {
  /** Uses that still count towards the limits (orders not expired or cancelled). */
  uses: number;
  /** Of the paid orders: what the coupon took off, and what those orders came to. */
  discountCents: number;
  salesCents: number;
};

/** Every coupon, newest first, with how much it has been used. */
export async function listCoupons(db: Db): Promise<CouponWithStats[]> {
  const rows = await db.rows<CouponsRow & { uses: number; discount_cents: number; sales_cents: number }>`
    select c.*, u.uses, u.discount_cents, u.sales_cents
    from public.coupons c
    cross join lateral (
      select count(*)::integer as uses,
             coalesce(sum(r.discount_cents) filter (where o.paid_at is not null), 0)::integer as discount_cents,
             coalesce(sum(o.total_cents) filter (where o.paid_at is not null), 0)::integer as sales_cents
      from public.coupon_redemptions r
      join public.orders o on o.id = r.order_id
      where r.coupon_id = c.id and o.payment_status not in ('expired', 'cancelled')
    ) u
    order by c.created_at desc`;
  return rows.map((r) => ({ ...toCoupon(r), uses: r.uses, discountCents: r.discount_cents, salesCents: r.sales_cents }));
}

export async function getCoupon(db: Db, id: string): Promise<Coupon | null> {
  const row = await db.one<CouponsRow>`select * from public.coupons where id = ${id}`;
  return row ? toCoupon(row) : null;
}

export type CouponOrder = {
  id: string;
  reference: string;
  customerEmail: string | null;
  paymentStatus: string;
  totalCents: number;
  discountCents: number;
  overLimit: boolean;
  paidAt: string | null;
  createdAt: string;
};

/** The orders priced with a coupon, newest first (their snapshot: they outlive an edited coupon). */
export async function couponOrders(db: Db, id: string): Promise<CouponOrder[]> {
  const rows = await db.rows<{
    id: string;
    reference: string;
    customer_email: string | null;
    payment_status: string;
    total_cents: number;
    coupon_discount_cents: number;
    coupon_over_limit: boolean;
    paid_at: string | null;
    created_at: string;
  }>`
    select id, reference, customer_email, payment_status, total_cents, coupon_discount_cents, coupon_over_limit,
           paid_at, created_at
    from public.orders where coupon_id = ${id} order by created_at desc limit 200`;
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    customerEmail: r.customer_email,
    paymentStatus: r.payment_status,
    totalCents: r.total_cents,
    discountCents: r.coupon_discount_cents,
    overLimit: r.coupon_over_limit,
    paidAt: r.paid_at,
    createdAt: r.created_at,
  }));
}

const notFound = () => new CommerceError('UNAVAILABLE', 'No existe ese cupón.', 404);

const isPgCode = (err: unknown, code: string) =>
  Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === code);

/** Forget the banner's coupon: call once a change to a coupon has committed. */
export function forgetAnnouncedCoupon(): void {
  announced = null;
}

/**
 * Run inside one transaction (asUser), then call forgetAnnouncedCoupon() once it
 * has committed (resetting inside would let a read cache the old row). `announce` goes in the one-row statement
 * that saves the coupon: the database trigger takes it off the others, so it is
 * never updated on several rows at once.
 */
export async function saveCoupon(tx: Db, c: CouponInput): Promise<string> {
  const row = {
    code: c.code,
    note: c.note,
    status: c.status,
    kind: c.kind,
    percent: c.percent,
    amount_cents: c.amountCents,
    cap_cents: c.capCents,
    buy_qty: c.buyQty,
    get_qty: c.getQty,
    nth: c.nth,
    category_ids: c.categoryIds,
    collection_ids: c.collectionIds,
    product_ids: c.productIds,
    excluded_product_ids: c.excludedProductIds,
    min_subtotal_cents: c.minSubtotalCents,
    min_units: c.minUnits,
    zone_ids: c.zoneIds,
    allow_shipping: c.allowShipping,
    allow_pickup: c.allowPickup,
    first_order_only: c.firstOrderOnly,
    require_account: c.requireAccount,
    emails: c.emails,
    emails_require_account: c.emailsRequireAccount,
    starts_at: c.startsAt,
    ends_at: c.endsAt,
    weekdays: c.weekdays,
    max_uses: c.maxUses,
    max_uses_per_customer: c.maxUsesPerCustomer,
    announce: c.announce,
  };
  if (c.id) {
    const saved = await tx.one<{ id: string }>`
      update public.coupons set ${setColumns(row)} where id = ${c.id} returning id`;
    if (!saved) throw notFound();
    return saved.id;
  }
  const saved = await tx.one<{ id: string }>`
    insert into public.coupons ${insertValues(row)} returning id`;
  return saved!.id;
}

/**
 * Pause, reactivate or archive. Any status change bumps the coupon's version, so
 * an open quote priced with it fails at reserve_checkout with PRICE_CHANGED and
 * the checkout prices it again.
 */
export async function setCouponStatus(db: Db, id: string, status: CouponStatus): Promise<void> {
  const changed = await db.run`update public.coupons set status = ${status}::public.coupon_status where id = ${id}`;
  if (changed === 0) throw notFound();
  announced = null;
}

/** A copy, paused and not announced, with the code plus -2 (or -3…) when that one is taken. */
export async function duplicateCoupon(db: Db, id: string): Promise<string> {
  const source = await db.one<{ code: string }>`select code from public.coupons where id = ${id}`;
  if (!source) throw notFound();
  for (let n = 2; n < 30; n++) {
    const suffix = `-${n}`;
    const code = `${source.code.slice(0, 30 - suffix.length)}${suffix}`;
    try {
      const copy = await db.one<{ id: string }>`
        insert into public.coupons (
          code, note, status, kind, percent, amount_cents, cap_cents, buy_qty, get_qty, nth,
          category_ids, collection_ids, product_ids, excluded_product_ids, min_subtotal_cents, min_units,
          zone_ids, allow_shipping, allow_pickup, first_order_only, require_account, emails, emails_require_account,
          starts_at, ends_at, weekdays, max_uses, max_uses_per_customer, announce)
        select ${code}, note, 'paused', kind, percent, amount_cents, cap_cents, buy_qty, get_qty, nth,
          category_ids, collection_ids, product_ids, excluded_product_ids, min_subtotal_cents, min_units,
          zone_ids, allow_shipping, allow_pickup, first_order_only, require_account, emails, emails_require_account,
          starts_at, ends_at, weekdays, max_uses, max_uses_per_customer, false
        from public.coupons where id = ${id}
        returning id`;
      if (!copy) throw notFound();
      return copy.id;
    } catch (err) {
      if (!isPgCode(err, '23505')) throw err;
    }
  }
  throw new CommerceError('CONFLICT', 'No se pudo encontrar un código libre para la copia.', 409);
}

/** Only a coupon nobody has used: past orders keep pointing at the ones used. */
export async function deleteCoupon(db: Db, id: string): Promise<void> {
  try {
    const removed = await db.run`delete from public.coupons where id = ${id}`;
    if (removed === 0) throw notFound();
  } catch (err) {
    // coupon_redemptions.coupon_id restricts the delete (23001; 23503 is its NO ACTION twin).
    if (isPgCode(err, '23001') || isPgCode(err, '23503')) {
      throw new CommerceError('CONFLICT', 'Este cupón ya se ha usado: archívalo en lugar de borrarlo.', 409);
    }
    throw err;
  }
  announced = null;
}

// --- the banner ---------------------------------------------------------------

/**
 * The coupon shown on the shop's banner: announced, active and within its dates
 * (public pages; the row is kept five minutes, the dates are judged on every call).
 */
export async function announcedCoupon(): Promise<AnnouncedCoupon | null> {
  if (!announced || Date.now() - announced.at > KEEP_MS) {
    const db = serviceDb();
    const value = db
      ? db
          .one<CouponsRow>`select * from public.coupons where announce and status = 'active' limit 1`
          .then((row): Announced | null =>
            row
              ? { code: row.code, kind: row.kind, percent: row.percent, amountCents: row.amount_cents, startsAt: row.starts_at, endsAt: row.ends_at }
              : null,
          )
          .catch((err: unknown) => {
            // A failure is not kept: the next visit asks again.
            console.error('[coupons] banner coupon not read', err);
            if (announced?.value === value) announced = null;
            return null;
          })
      : Promise.resolve(null);
    announced = { at: Date.now(), value };
  }
  const coupon = await announced.value;
  if (!coupon) return null;
  const now = Date.now();
  if (coupon.startsAt && Date.parse(coupon.startsAt) > now) return null;
  if (coupon.endsAt && Date.parse(coupon.endsAt) <= now) return null;
  const { startsAt: _startsAt, ...visible } = coupon;
  return visible;
}
