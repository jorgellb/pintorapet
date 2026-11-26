import type { AdminReview, AdminReviewPhoto } from '@/lib/server/reviews/store';
import type { ReviewStatus } from '@/lib/domain/reviews';

/** How Admin › Opiniones shows a review: tabs, stars, photo addresses and what it is about. */

export const REVIEW_TABS: Array<{ key: string; label: string; status: ReviewStatus }> = [
  { key: 'pendientes', label: 'Pendientes', status: 'pending' },
  { key: 'publicadas', label: 'Publicadas', status: 'published' },
  { key: 'ocultas', label: 'Ocultas', status: 'hidden' },
];

export const stars = (rating: number | null) => (rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : '');

export const starsLabel = (rating: number | null) => (rating ? `${rating} de 5 estrellas` : 'Sin estrellas');

/** A customer's photo is private until the review is published: Admin reads it through its own route. */
export function photoSrc(reviewId: string, photo: AdminReviewPhoto): string | null {
  if (photo.url) return photo.url;
  return photo.source === 'private' ? `/api/admin/reviews/${reviewId}/photos/${photo.id}/` : null;
}

export const sourceLabel = (review: Pick<AdminReview, 'source'>) => (review.source === 'customer' ? 'Cliente' : 'Meili');

/** What the review is about, in words. */
export function aboutLabel(review: Pick<AdminReview, 'kind' | 'productTitle'>): string {
  if (review.kind === 'commission') return 'Encargo';
  return review.productTitle ?? 'En general';
}

export const excerpt = (text: string, max = 180) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** One entry of the «Producto» / «Sobre qué es» select: `''` is «En general», `p:<id>` a product, `c:<id>` a commission. */
export type AboutOption = { value: string; label: string };

/**
 * What a customer's review is about, as the select's value. Only the product counts:
 * a customer cannot change the commission, and the select cannot offer it.
 */
export const customerAbout = (review: { productId: string | null; commissionRequestId?: string | null }): string => (review.productId ? `p:${review.productId}` : '');

/** What Meili's own review is about: a commission wins over a product. */
export function adminAbout(review: { productId: string | null; commissionRequestId: string | null }): string {
  if (review.commissionRequestId) return `c:${review.commissionRequestId}`;
  return review.productId ? `p:${review.productId}` : '';
}

/**
 * The options of the select with the current value always among them. A value the
 * list does not hold (a product no longer in the order, an archived one, an old
 * commission) would leave the select on «En general»: the page would think it
 * changed, block publishing and, on save, erase what the review is about.
 */
export function withCurrent(options: AboutOption[], current: string, currentLabel: string): AboutOption[] {
  if (current === '' || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: currentLabel }];
}
