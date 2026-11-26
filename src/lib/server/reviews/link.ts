import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '@/lib/server/db';
import { siteUrl } from '@/lib/server/env';
import { storagePublicUrl } from '@/lib/server/storageUrl';
import { REVIEW_LINK_DAYS, type ReviewLocale, type ReviewStatus } from '@/lib/domain/reviews';

/**
 * The personal link to review an order. The key is not stored: it is an HMAC of
 * the order id, so the email, "Mi cuenta" and Admin's copy button all give the
 * same link. It opens one review of one order and lapses 120 days after payment.
 */

function secret(): string {
  const value = import.meta.env.REVIEW_LINK_SECRET || import.meta.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error('REVIEW_LINK_SECRET (or BETTER_AUTH_SECRET) is not set');
  return String(value);
}

/** base64url HMAC-SHA256 of `review:<orderId>`. The secret is a parameter for tests. */
export function reviewKey(orderId: string, key: string = secret()): string {
  return createHmac('sha256', key).update(`review:${orderId}`).digest('base64url');
}

export function reviewUrl(order: { id: string; reference: string; locale: ReviewLocale }): string {
  const path = order.locale === 'en' ? 'en/review' : 'es/opinion';
  const query = new URLSearchParams({ r: order.reference, k: reviewKey(order.id) });
  return `${siteUrl()}/${path}/?${query}`;
}

const DAY_MS = 86_400_000;

/** Paid (card, PayPal, Bizum, transfer, phone, stall, commission) and not refunded in full or cancelled. */
export function reviewEligible(order: { paid_at: string | null; payment_status: string }, now = Date.now()): boolean {
  if (order.payment_status !== 'paid' && order.payment_status !== 'partially_refunded') return false;
  if (!order.paid_at) return false;
  const paid = Date.parse(order.paid_at);
  return Number.isFinite(paid) && now - paid <= REVIEW_LINK_DAYS * DAY_MS;
}

/** The review an order already has, as its owner sees it. */
export type CustomerReview = {
  id: string;
  status: ReviewStatus;
  rating: number | null;
  body: string;
  authorName: string;
  city: string;
  petName: string;
  productId: string | null;
  locale: ReviewLocale;
  /** Only ids: the private photos are never sent back out. */
  photoIds: string[];
  /** Still pending and Meili has not touched it. */
  editable: boolean;
};

export type ReviewOrder = {
  id: string;
  reference: string;
  locale: ReviewLocale;
  kind: 'product' | 'commission';
  commissionRequestId: string | null;
  products: Array<{ id: string; title: string; imageUrl: string | null }>;
  review: CustomerReview | null;
};

type OrderRow = {
  id: string;
  reference: string;
  locale: ReviewLocale;
  payment_status: string;
  paid_at: string | null;
  commission_request_id: string | null;
};

type ReviewRow = {
  id: string;
  status: ReviewStatus;
  rating: number | null;
  body: string;
  author_name: string;
  city: string;
  pet_name: string;
  product_id: string | null;
  locale: ReviewLocale;
  admin_edited_at: string | null;
};

function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const NO_ORDER = '00000000-0000-0000-0000-000000000000';

/**
 * The order a link opens, or null. An unknown reference, a wrong key, an
 * expired or refunded order and another order's key all give the same null, so
 * nothing about an order leaks to whoever does not hold its link.
 */
export async function openReviewLink(db: Db, reference: string, key: string, now = Date.now()): Promise<ReviewOrder | null> {
  const order = await db.one<OrderRow>`
    select id, reference, locale, payment_status, paid_at, commission_request_id
    from public.orders where reference = ${reference}`;
  // Compare even when there is no such order, so the time taken says nothing either.
  const matches = sameKey(key, reviewKey(order?.id ?? NO_ORDER));
  if (!order || !matches || !reviewEligible(order, now)) return null;

  const [items, review, photos] = await Promise.all([
    db.rows<{ product_id: string; title: string; bucket: string | null; object_path: string | null }>`
      select i.product_id, min(i.product_title) as title, min(a.bucket) as bucket, min(a.object_path) as object_path
      from public.order_items i left join public.media_assets a on a.id = i.media_asset_id
      where i.order_id = ${order.id} and i.product_id is not null
      group by i.product_id order by min(i.created_at), i.product_id`,
    db.one<ReviewRow>`
      select id, status, rating, body, author_name, city, pet_name, product_id, locale, admin_edited_at
      from public.reviews where order_id = ${order.id}`,
    db.rows<{ id: string }>`
      select p.id from public.review_photos p join public.reviews r on r.id = p.review_id
      where r.order_id = ${order.id} order by p.position`,
  ]);

  return {
    id: order.id,
    reference: order.reference,
    locale: order.locale,
    kind: order.commission_request_id ? 'commission' : 'product',
    commissionRequestId: order.commission_request_id,
    products: items.map((p) => ({
      id: p.product_id,
      title: p.title,
      imageUrl: p.bucket && p.object_path ? storagePublicUrl(p.bucket, p.object_path) : null,
    })),
    review: review
      ? {
          id: review.id,
          status: review.status,
          rating: review.rating,
          body: review.body,
          authorName: review.author_name,
          city: review.city,
          petName: review.pet_name,
          productId: review.product_id,
          locale: review.locale,
          photoIds: photos.map((p) => p.id),
          editable: review.status === 'pending' && review.admin_edited_at === null,
        }
      : null,
  };
}
