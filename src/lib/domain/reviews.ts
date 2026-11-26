import { z } from 'zod';

/**
 * Customer reviews with photos (Admin › Opiniones). What the pages, the API
 * and the admin know about them: the shapes the forms send, the shape the web
 * reads, the default display name, the photo alt text and the rating summary.
 */

export const REVIEW_MAX_PHOTOS = 3;
export const REVIEW_MAX_BODY = 1500;
/** A link works this long after the order was paid. */
export const REVIEW_LINK_DAYS = 120;
/** Contact lists this many reviews per page. */
export const REVIEWS_PER_PAGE = 12;
/** Structured data carries at most this many reviews. */
export const JSON_LD_MAX = 10;

export type ReviewStatus = 'pending' | 'published' | 'hidden';
export type ReviewKind = 'product' | 'commission' | 'general';
export type ReviewSource = 'customer' | 'admin';
export type ReviewLocale = 'es' | 'en';

const rating = z.number().int().min(1).max(5);
const name = z.string().trim().min(1).max(80);
const city = z.string().trim().max(80);
const petName = z.string().trim().max(60);

/** What the customer sends from their link (the page also sends the anti-bot fields, removed before). */
export const reviewInputSchema = z
  .object({
    reference: z.string().trim().min(3).max(40),
    key: z.string().trim().min(16).max(128),
    rating: rating.nullish(),
    body: z.string().trim().min(1).max(REVIEW_MAX_BODY),
    authorName: name,
    city: city.default(''),
    petName: petName.default(''),
    productId: z.uuid().nullish(),
    locale: z.enum(['es', 'en']),
    consent: z.literal(true),
  })
  .strict();
export type ReviewInput = z.infer<typeof reviewInputSchema>;

/** Meili's "Nueva opinión": a review she writes herself, with photos picked from Medios. */
export const adminReviewSchema = z
  .object({
    authorName: name,
    city: city.default(''),
    petName: petName.default(''),
    body: z.string().trim().min(1).max(REVIEW_MAX_BODY),
    rating: rating.nullable().default(null),
    locale: z.enum(['es', 'en']),
    productId: z.uuid().nullable().default(null),
    commissionRequestId: z.uuid().nullable().default(null),
    photoIds: z.array(z.uuid()).max(REVIEW_MAX_PHOTOS).default([]),
    featured: z.boolean().default(false),
    /** Publish it at once instead of leaving it pending. */
    publish: z.boolean().default(false),
  })
  .strict();
export type AdminReviewInput = z.infer<typeof adminReviewSchema>;

/**
 * A change to a review. For a customer's review only the display fields, the
 * product and `featured` may be sent; the rest is refused by updateReview.
 */
export const reviewPatchSchema = z
  .object({
    authorName: name,
    city,
    petName,
    body: z.string().trim().min(1).max(REVIEW_MAX_BODY),
    rating: rating.nullable(),
    locale: z.enum(['es', 'en']),
    productId: z.uuid().nullable(),
    commissionRequestId: z.uuid().nullable(),
    photoIds: z.array(z.uuid()).max(REVIEW_MAX_PHOTOS),
    featured: z.boolean(),
  })
  .partial()
  .strict();
export type ReviewPatch = z.infer<typeof reviewPatchSchema>;

/** The fields a customer's review keeps as the customer wrote them. */
export const LOCKED_FOR_CUSTOMER_REVIEWS = ['body', 'rating', 'locale', 'commissionRequestId', 'photoIds'] as const;

/** A commission's review is a commission review; otherwise it is about a product, or the order in general. */
export function reviewKind(productId: string | null | undefined, commissionRequestId: string | null | undefined): ReviewKind {
  if (commissionRequestId) return 'commission';
  return productId ? 'product' : 'general';
}

/** "Ana García López" → "Ana G."; a single name stays as it is. */
export function defaultAuthorName(fullName: string): string {
  const words = fullName.normalize('NFC').trim().split(/\s+/).filter(Boolean);
  const [first, second] = words;
  if (!first) return '';
  if (!second) return first;
  const initial = Array.from(second)[0]!.toLocaleUpperCase();
  return `${first} ${initial}.`;
}

export type PublicReviewPhoto = { url: string; alt: string };

/** A published review as the web shows it. */
export type PublicReview = {
  id: string;
  authorName: string;
  city: string;
  petName: string;
  body: string;
  /** The language it was written in; it is shown as written, never translated. */
  locale: ReviewLocale;
  rating: number | null;
  verified: boolean;
  photos: PublicReviewPhoto[];
  publishedAt: string;
  productId: string | null;
  kind: ReviewKind;
};

/** «Retrato de {mascota} en casa de {nombre}», in the language the review was written in. */
export function reviewPhotoAlt(review: { authorName: string; petName: string }, locale: ReviewLocale): string {
  const author = review.authorName.trim();
  const pet = review.petName.trim();
  if (locale === 'en') {
    const home = author ? `${author}'s home` : 'a customer’s home';
    return pet ? `Portrait of ${pet} at ${home}` : `Portrait at ${home}`;
  }
  const home = author ? `casa de ${author}` : 'casa de una clienta';
  return pet ? `Retrato de ${pet} en ${home}` : `Retrato en ${home}`;
}

export const roundTenth = (value: number) => Math.round(value * 10) / 10;

export type RatingStats = { average: number | null; count: number };

/** The average (one decimal) and number of the starred reviews in a list. */
export function ratingStats(list: PublicReview[]): RatingStats {
  const rated = list.filter((r) => r.rating !== null);
  if (rated.length === 0) return { average: null, count: 0 };
  const total = rated.reduce((sum, r) => sum + (r.rating ?? 0), 0);
  return { average: roundTenth(total / rated.length), count: rated.length };
}

export type ProductReviews = {
  /** The product's published reviews, newest first (with or without stars; the page lists these). */
  reviews: PublicReview[];
  /** What the page shows: over every published review that has stars. */
  average: number | null;
  count: number;
  /**
   * What structured data says. `average` and `count` cover ALL the product's
   * published, verified reviews with stars; `items` are the ten newest of those.
   */
  jsonLd: { items: PublicReview[]; average: number | null; count: number };
};

/**
 * `reviews` are the product's published ones, newest first. When the list is
 * cut short (a very popular product), the caller passes the true figures and
 * the ten newest verified starred reviews from the database.
 */
export function productReviewSummary(
  reviews: PublicReview[],
  whole?: { visible: RatingStats; verified: RatingStats; items: PublicReview[] },
): ProductReviews {
  const verifiedRated = reviews.filter((r) => r.verified && r.rating !== null);
  const visible = whole?.visible ?? ratingStats(reviews);
  const verified = whole?.verified ?? ratingStats(verifiedRated);
  return {
    reviews,
    ...visible,
    jsonLd: { items: (whole?.items ?? verifiedRated).slice(0, JSON_LD_MAX), ...verified },
  };
}

/** About this many characters of a review, cut at a word, for the cards that open the whole text. */
export const REVIEW_EXCERPT_CHARS = 220;

/** The text itself when it is short, otherwise its first words and an ellipsis. */
export function reviewExcerpt(body: string, max = REVIEW_EXCERPT_CHARS): { text: string; cut: boolean } {
  const text = body.trim();
  const chars = Array.from(text);
  if (chars.length <= max) return { text, cut: false };
  const head = chars.slice(0, max).join('');
  // back to the last space unless that would drop most of it (one very long word)
  const space = head.lastIndexOf(' ');
  const clean = (space > max * 0.6 ? head.slice(0, space) : head).replace(/[\s,.;:!?¡¿-]+$/u, '');
  return { text: `${clean}…`, cut: true };
}
